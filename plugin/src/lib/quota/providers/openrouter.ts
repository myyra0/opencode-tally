// OpenRouter key spending adapter: prefers the binding effective budget, then legacy key fields.

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
  OpenRouterProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "../types.js"
import { countQuota, resetInstantOrNull, unknownQuota } from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

const OFFICIAL_ORIGIN = "https://openrouter.ai"
const KEY_PATH = "/api/v1/key"
const PROVIDER_ID = "openrouter" as const

interface KeyLimit {
  readonly limit: number
  readonly remaining: number
  readonly resetKind: UsageWindow["kind"]
  readonly resetsAt: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    providerID: PROVIDER_ID,
    message: "OpenRouter response could not be decoded",
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    providerID: PROVIDER_ID,
    message: "OpenRouter credentials are missing",
  })

function resetKind(value: unknown): UsageWindow["kind"] {
  return value === "daily" || value === "weekly" || value === "monthly"
    ? value
    : "credits"
}

/** undefined = malformed value, null = absent or numerically unusable. */
function optionalLimitNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value

  if (typeof value !== "number" || value < 0) return undefined

  return Number.isFinite(value) ? value : null
}

/** Reads the binding budget OpenRouter says applies, when the payload carries one. */
function parseEffectiveBudget(data: Record<string, unknown>): KeyLimit | null | undefined {
  const budget = data.effective_budget
  if (!isRecord(budget)) return undefined

  const limit = optionalLimitNumber(budget.limit_usd)
  const remaining = optionalLimitNumber(budget.remaining_usd)
  if (limit === undefined || remaining === undefined) return undefined
  if (limit === null || remaining === null || limit <= 0) return null

  return {
    limit,
    remaining: Math.min(limit, remaining),
    resetKind: resetKind(budget.reset_interval),
    resetsAt: resetInstantOrNull(budget.resets_at),
  }
}

/** undefined = malformed response, null = no usable limit to report. */
function parseKeyLimit(
  data: Record<string, unknown>
): KeyLimit | null | undefined {
  const budget = parseEffectiveBudget(data)
  if (budget) return budget

  const limit = optionalLimitNumber(data.limit)
  const remaining = optionalLimitNumber(data.limit_remaining)

  const invalidLimit =
    data.limit !== undefined && data.limit !== null && limit === undefined
  const invalidRemaining =
    data.limit_remaining !== undefined &&
    data.limit_remaining !== null &&
    remaining === undefined

  if (invalidLimit || invalidRemaining) return undefined
  if (limit === undefined || limit === null || limit === 0) return null
  if (remaining === undefined || remaining === null) return null

  return {
    limit,
    remaining: Math.min(limit, remaining),
    resetKind: resetKind(data.limit_reset),
    resetsAt: null,
  }
}

function keyLimitWindow(keyLimit: KeyLimit | null): UsageWindow {
  if (keyLimit === null) {
    return {
      kind: "credits",
      label: "spend limit",
      quota: unknownQuota,
      resetsAt: null,
    }
  }

  const current = keyLimit.limit - keyLimit.remaining
  const percentage = (current / keyLimit.limit) * 100

  return {
    kind: keyLimit.resetKind,
    label: "spend",
    quota: countQuota(current, keyLimit.limit, percentage, "USD"),
    resetsAt: keyLimit.resetsAt,
  }
}

/** Uses the fixed key path, discarding any configured path, query, or fragment. */
function keyUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = KEY_PATH
  url.search = ""
  url.hash = ""

  return url.toString()
}

/** Fetches OpenRouter key spending-limit usage from its documented current-key API. */
export async function fetchOpenRouterUsage(
  config: OpenRouterProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"openrouter">> {
  const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, OFFICIAL_ORIGIN)
  const official = officialOrigin(baseUrl, "openrouter.ai")

  const authFileKey = await readAuthFileCredential(config?.authPath, PROVIDER_ID)
  const configuredKey = resolveCredential(config?.apiKey)

  const entry = openCodeAuth?.openrouter
  const authKey = entry
    ? resolveCredential(entry.key) ?? resolveCredential(entry.apiKey)
    : undefined

  // A custom origin never receives an automatically discovered OpenCode credential.
  const apiKey =
    authFileKey ??
    pickCredential({ official, discovered: authKey, configured: configuredKey })

  if (!apiKey) throw missingCredentials()

  const payload = await requestJson({
    url: keyUrl(baseUrl),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    method: "GET",
    providerID: PROVIDER_ID,
    timeoutMs,
  })

  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
  const parsed = data ? parseKeyLimit(data) : undefined
  if (parsed === undefined) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? "OpenRouter",
    windows: [keyLimitWindow(parsed)],
  }
}

/** OpenRouter key spending-limit adapter and OpenCode provider mapping. */
export const openRouterProvider: ProviderDefinition<"openrouter"> = {
  defaultLabel: "OpenRouter",
  displayOrder: 10,
  fetch: fetchOpenRouterUsage,
  footerWindowKind: "credits",
  id: "openrouter",
  openCodeProviderIDs: ["openrouter"],
}
