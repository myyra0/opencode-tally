// ZAI Coding Plan window adapter, including credit-based plans.

import {
  readAuthFileCredential,
  resolveCredential,
  type OpenCodeAuth,
} from "../auth.js"
import { ProviderError } from "../errors.js"
import { requestJson } from "../http.js"
import type { ProviderDefinition } from "../registry.js"
import type { ProviderUsage, UsageWindow, ZaiProviderConfig } from "../types.js"
import {
  countQuota,
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
  unknownQuota,
} from "../usage.js"

const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

interface ZaiLimit {
  readonly currentValue?: number
  readonly nextResetTime?: number
  readonly number?: number
  readonly percentage?: number
  readonly type?: string
  readonly unit?: number
  readonly usage?: number
}

interface ZaiPayload {
  readonly level?: string
  readonly limits: ZaiLimit[]
}

interface ZaiWindowShape {
  readonly kind: UsageWindow["kind"]
  readonly label: string
}

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    message: "ZAI response could not be decoded",
    providerID: "zai",
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    message: "ZAI credentials are missing",
    providerID: "zai",
  })

/** Reads the first recognized key from any supported auth object shape. */
function keyFromZaiAuth(value: Record<string, unknown>): string | undefined {
  const directKey = resolveCredential(
    typeof value.key === "string" ? value.key : undefined
  )
  if (directKey) return directKey

  const directApiKey = resolveCredential(
    typeof value.apiKey === "string" ? value.apiKey : undefined
  )
  if (directApiKey) return directApiKey

  const plan = value["zai-coding-plan"]
  if (isRecord(plan)) {
    const key = resolveCredential(typeof plan.key === "string" ? plan.key : undefined)
    if (key) return key
  }

  // Nested entries expose only `key`; direct top-level `key`/`apiKey` are handled above.
  const zai = value.zai
  if (isRecord(zai)) {
    return resolveCredential(typeof zai.key === "string" ? zai.key : undefined)
  }

  return undefined
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

function parseZaiPayload(value: unknown): ZaiPayload | null {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.limits)) {
    return null
  }

  const limits = value.data.limits.flatMap((limit): ZaiLimit[] => {
    if (!isRecord(limit)) return []

    return [
      {
        currentValue: finiteNumber(limit.currentValue),
        nextResetTime: finiteNumber(limit.nextResetTime),
        number: finiteNumber(limit.number),
        percentage: finiteNumber(limit.percentage),
        type: typeof limit.type === "string" ? limit.type : undefined,
        unit: finiteNumber(limit.unit),
        usage: finiteNumber(limit.usage),
      },
    ]
  })

  return {
    level: typeof value.data.level === "string" ? value.data.level : undefined,
    limits,
  }
}

/** Combines count and percentage reporting, falling back to percentage-only quota. */
function zaiQuota(limit: ZaiLimit, usedPercent: number | null) {
  let used: number
  try {
    used = parseUsagePercentage(usedPercent)
  } catch {
    return unknownQuota
  }

  // Credit limits report the entitlement in `usage`; token limits only expose the
  // consumed count, so their total is derived from the reported percentage.
  let current = limit.currentValue
  let total = limit.usage

  if (limit.type === "TOKENS_LIMIT") {
    current = current === undefined ? undefined : Math.round(current)
    total =
      current === undefined || used <= 0
        ? undefined
        : Math.round(current / (used / 100))
  }

  try {
    const parsedCurrent = parseUsageCount(current, "ZAI current count")
    const parsedTotal = parseUsageCount(total, "ZAI total count")
    if (parsedCurrent <= parsedTotal) return countQuota(parsedCurrent, parsedTotal, used)
  } catch {
    // Invalid or missing counts downgrade to the reported percentage.
  }

  return percentageQuota(used)
}

/** Maps the API window identifier to a kind and label; unit 3 is hours, 6 is days. */
function zaiWindowShape(limit: ZaiLimit): ZaiWindowShape | null {
  if (limit.type !== "TOKENS_LIMIT" && limit.type !== "CREDIT_LIMIT") return null

  if (limit.unit === undefined || limit.number === undefined) {
    // Legacy payloads omitted the shape fields; their only window was 5 hours.
    return { kind: "rolling", label: "5h" }
  }

  if (limit.unit === 3) {
    return limit.number === 5
      ? { kind: "rolling", label: "5h" }
      : { kind: "other", label: `${limit.number}h` }
  }

  if (limit.unit === 6) {
    return limit.number === 1
      ? { kind: "weekly", label: "weekly" }
      : { kind: "other", label: `${limit.number}d` }
  }

  if (limit.unit === 5 && limit.number === 1) {
    return { kind: "monthly", label: "monthly" }
  }

  return { kind: "other", label: `${limit.number}/${limit.unit}` }
}

/** Converts one raw limit into a window plus any discovered prompt total. */
function zaiWindowFromLimit(limit: ZaiLimit): {
  promptTotal: number | null
  window: UsageWindow | null
} {
  let usedPercent: number | null = null
  try {
    usedPercent = parseUsagePercentage(limit.percentage)
  } catch {
    // Fall through to a derived percentage when credit counts are available.
  }

  if (
    usedPercent === null &&
    limit.currentValue !== undefined &&
    limit.usage !== undefined &&
    limit.usage > 0
  ) {
    usedPercent = Math.min(100, Math.max(0, (limit.currentValue / limit.usage) * 100))
  }

  const shape = zaiWindowShape(limit)

  if (!shape) {
    return {
      promptTotal: limit.type === "TIME_LIMIT" ? (limit.usage ?? null) : null,
      window: null,
    }
  }

  return {
    promptTotal: null,
    window: {
      ...shape,
      quota: zaiQuota(limit, usedPercent),
      resetsAt: resetInstantOrNull(limit.nextResetTime),
    },
  }
}

function parseZaiLimits(limits: readonly ZaiLimit[]): {
  promptTotal: number | null
  windows: UsageWindow[]
} {
  const windows: UsageWindow[] = []
  let promptTotal: number | null = null
  let sawQuotaLimit = false

  for (const limit of limits) {
    if (!limit.type) continue

    const usage = zaiWindowFromLimit(limit)
    if (limit.type === "TOKENS_LIMIT" || limit.type === "CREDIT_LIMIT") {
      sawQuotaLimit = true
    }
    if (usage.window) windows.push(usage.window)
    if (usage.promptTotal !== null) promptTotal = usage.promptTotal
  }

  if (sawQuotaLimit && windows.every((window) => window.quota._tag === "Unknown")) {
    throw decodeError()
  }

  return { promptTotal, windows }
}

/** Prefers the API's plan level, then the legacy time-limit prompt total. */
function zaiTier(level: string | undefined, promptTotal: number | null): string | undefined {
  if (level !== undefined && level.trim() !== "") {
    return level.charAt(0).toUpperCase() + level.slice(1)
  }

  if (promptTotal === null) return undefined
  if (promptTotal >= 1400) return "Max"
  if (promptTotal >= 300) return "Pro"
  if (promptTotal > 0) return "Lite"
  return undefined
}

/** Fetches ZAI Coding Plan quota windows from the usage API. */
export async function fetchZaiCodingPlanUsage(
  config: ZaiProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"zai">> {
  const authFileKey = await readAuthFileCredential(
    config?.authPath,
    "zai",
    keyFromZaiAuth
  )
  const configuredKey = resolveCredential(config?.apiKey)
  const authKey = keyFromZaiAuth(openCodeAuth as Record<string, unknown>)
  const apiKey = authFileKey ?? authKey ?? configuredKey

  if (!apiKey) throw missingCredentials()

  const scheme = config?.authorizationScheme ?? "raw"
  const payload = await requestJson({
    url: ZAI_QUOTA_URL,
    headers: {
      "Accept-Language": "en-US,en",
      Authorization: scheme === "bearer" ? `Bearer ${apiKey}` : apiKey,
      "Content-Type": "application/json",
    },
    method: "GET",
    providerID: "zai",
    timeoutMs,
  })

  const body = parseZaiPayload(payload)
  if (!body) throw decodeError()

  let parsed: ReturnType<typeof parseZaiLimits>
  try {
    parsed = parseZaiLimits(body.limits)
  } catch {
    throw decodeError()
  }

  if (parsed.windows.length === 0) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: "zai",
    label: config?.label ?? "ZAI",
    tierName: zaiTier(body.level, parsed.promptTotal),
    windows: parsed.windows,
  }
}

/** ZAI Coding Plan adapter and OpenCode provider-ID mapping. */
export const zaiProvider: ProviderDefinition<"zai"> = {
  defaultLabel: "ZAI",
  displayOrder: 1,
  fetch: fetchZaiCodingPlanUsage,
  footerWindowKind: "rolling",
  id: "zai",
  openCodeProviderIDs: ["zai-coding-plan"],
}
