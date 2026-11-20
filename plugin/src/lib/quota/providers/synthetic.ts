// Synthetic rolling and weekly window adapter.

import {
  officialOrigin,
  pickCredential,
  readAuthFileCredential,
  resolveCredential,
  type OpenCodeAuth,
} from "../auth.js"
import { ProviderError } from "../errors.js"
import { requestJson } from "../http.js"
import type { ProviderDefinition } from "../registry.js"
import type {
  ProviderUsage,
  SyntheticProviderConfig,
  UsageQuota,
  UsageWindow,
} from "../types.js"
import {
  countQuota,
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
} from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

const DEFAULT_SYNTHETIC_BASE_URL = "https://api.synthetic.new"
const OFFICIAL_HOST = "api.synthetic.new"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

interface SyntheticPayload {
  readonly rolling?: {
    readonly max?: number
    readonly nextTickAt?: string
    readonly remaining?: number
  }
  readonly subscription?: {
    readonly limit?: number
    readonly renewsAt?: string
    readonly requests?: number
  }
  readonly weekly?: {
    readonly nextRegenAt?: string
    readonly percentRemaining?: number
  }
  readonly planWeekly?: {
    readonly nextRegenAt?: string
    readonly percentRemaining?: number
  }
}

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    message: "Synthetic response could not be decoded",
    providerID: "synthetic",
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    message: "Synthetic credentials are missing",
    providerID: "synthetic",
  })

/** Reads the first recognized key from any supported auth object shape. */
function keyFromSyntheticAuth(value: Record<string, unknown>): string | undefined {
  const directKey = resolveCredential(
    typeof value.key === "string" ? value.key : undefined
  )
  if (directKey) return directKey

  const directApiKey = resolveCredential(
    typeof value.apiKey === "string" ? value.apiKey : undefined
  )
  if (directApiKey) return directApiKey

  const synthetic = value.synthetic
  if (isRecord(synthetic)) {
    const key = resolveCredential(
      typeof synthetic.key === "string" ? synthetic.key : undefined
    )
    if (key) return key

    const apiKey = resolveCredential(
      typeof synthetic.apiKey === "string" ? synthetic.apiKey : undefined
    )
    if (apiKey) return apiKey
  }

  return undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function parseSyntheticPayload(value: unknown): SyntheticPayload {
  const record = isRecord(value) ? value : {}
  const bucket = (key: string) => (isRecord(record[key]) ? record[key] : undefined)

  const rolling = bucket("rollingFiveHourLimit")
  const subscription = bucket("subscription")
  const weekly = bucket("weeklyTokenLimit")
  const planWeekly = bucket("planWeeklyLimit")

  return {
    rolling: rolling
      ? {
          max: asNumber(rolling.max),
          nextTickAt: asString(rolling.nextTickAt),
          remaining: asNumber(rolling.remaining),
        }
      : undefined,
    subscription: subscription
      ? {
          limit: asNumber(subscription.limit),
          renewsAt: asString(subscription.renewsAt),
          requests: asNumber(subscription.requests),
        }
      : undefined,
    weekly: weekly
      ? {
          nextRegenAt: asString(weekly.nextRegenAt),
          percentRemaining: asNumber(weekly.percentRemaining),
        }
      : undefined,
    planWeekly: planWeekly
      ? {
          nextRegenAt: asString(planWeekly.nextRegenAt),
          percentRemaining: asNumber(planWeekly.percentRemaining),
        }
      : undefined,
  }
}

const tryCount = (value: unknown): number | null => {
  try {
    return parseUsageCount(value, "Synthetic count")
  } catch {
    return null
  }
}

const tryPercent = (value: unknown): number | null => {
  try {
    return parseUsagePercentage(value)
  } catch {
    return null
  }
}

function countQuotaWhenIntegral(
  current: number,
  total: number,
  usedPercent: number
): UsageQuota {
  return Number.isInteger(current) && Number.isInteger(total) && current <= total
    ? countQuota(current, total, usedPercent)
    : percentageQuota(usedPercent)
}

function parseIsoDate(value: string | undefined): number | null {
  return value === undefined ? null : resetInstantOrNull(new Date(value))
}

/** Builds the 5h window, preferring v3 rolling fields over the legacy subscription bucket. */
function syntheticFiveHourWindow(payload: SyntheticPayload): UsageWindow | null {
  const rolling = payload.rolling
  if (rolling) {
    const remaining = tryCount(rolling.remaining)
    const max = tryCount(rolling.max)

    if (remaining !== null && max !== null && max > 0 && remaining <= max) {
      const used = tryPercent((1 - remaining / max) * 100)
      if (used !== null) {
        return {
          kind: "rolling",
          label: "5h",
          quota: countQuotaWhenIntegral(max - remaining, max, used),
          resetsAt: parseIsoDate(rolling.nextTickAt),
        }
      }
    }
  }

  // The retired request counter coexists with planWeeklyLimit on current payloads;
  // it is not a five-hour window, so ignore it whenever the plan bucket is present.
  const subscription = payload.planWeekly ? undefined : payload.subscription
  if (subscription) {
    const limit = tryCount(subscription.limit)
    const requests = tryCount(subscription.requests)

    if (limit !== null && requests !== null && limit > 0 && requests <= limit) {
      const used = tryPercent((requests / limit) * 100)
      if (used !== null) {
        return {
          kind: "rolling",
          label: "5h",
          quota: countQuotaWhenIntegral(requests, limit, used),
          resetsAt: parseIsoDate(subscription.renewsAt),
        }
      }
    }
  }

  return null
}

/** Builds the weekly window, preferring current plan credits over the legacy limit. */
function syntheticWeeklyWindow(payload: SyntheticPayload): UsageWindow | null {
  for (const weekly of [payload.planWeekly, payload.weekly]) {
    if (!weekly) continue

    const remaining = tryPercent(weekly.percentRemaining)
    const used = remaining === null ? null : tryPercent(100 - remaining)
    if (used === null) continue

    return {
      kind: "weekly",
      label: "weekly",
      quota: percentageQuota(used),
      resetsAt: parseIsoDate(weekly.nextRegenAt),
    }
  }

  return null
}

/** Fetches Synthetic rolling and weekly quota data. */
export async function fetchSyntheticUsage(
  config: SyntheticProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"synthetic">> {
  const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_SYNTHETIC_BASE_URL)
  const official = officialOrigin(baseUrl, OFFICIAL_HOST)
  const configuredKey = resolveCredential(config?.apiKey)

  const authFileKey = await readAuthFileCredential(
    config?.authPath,
    "synthetic",
    keyFromSyntheticAuth
  )
  const authKey = keyFromSyntheticAuth(openCodeAuth as Record<string, unknown>)
  const apiKey = authFileKey ?? pickCredential({
    official,
    discovered: authKey,
    configured: configuredKey,
  })

  if (!apiKey) throw missingCredentials()

  const payload = await requestJson({
    url: `${baseUrl}/v2/quotas`,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    method: "GET",
    providerID: "synthetic",
    timeoutMs,
  })

  if (!isRecord(payload)) throw decodeError()
  const parsed = parseSyntheticPayload(payload)

  const windows: UsageWindow[] = []
  const fiveHour = syntheticFiveHourWindow(parsed)
  if (fiveHour) windows.push(fiveHour)

  const weekly = syntheticWeeklyWindow(parsed)
  if (weekly) windows.push(weekly)

  // Current plans are weekly-only, so a missing five-hour window is valid.
  if (windows.length === 0) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: "synthetic",
    label: config?.label ?? "Synthetic",
    windows,
  }
}

/** Synthetic adapter and OpenCode provider-ID mapping. */
export const syntheticProvider: ProviderDefinition<"synthetic"> = {
  defaultLabel: "Synthetic",
  displayOrder: 2,
  fetch: fetchSyntheticUsage,
  footerWindowKind: "rolling",
  id: "synthetic",
  openCodeProviderIDs: ["synthetic"],
}
