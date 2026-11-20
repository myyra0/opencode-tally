// Command Code quota adapter.

import {
  officialOrigin,
  readAuthFileCredential,
  resolveCredential,
  type OpenCodeAuth,
} from "../auth.js"
import { ProviderError } from "../errors.js"
import { requestJson } from "../http.js"
import type { ProviderDefinition } from "../registry.js"
import type {
  CommandCodeProviderConfig,
  ProviderUsage,
  UsageQuota,
  UsageWindow,
  UsageWindowKind,
} from "../types.js"
import {
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
  unknownQuota,
} from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

const DEFAULT_BASE_URL = "https://api.commandcode.ai"
const WHOAMI_PATH = "/alpha/whoami"
const CREDITS_PATH = "/alpha/billing/credits"
const SUMMARY_PATH = "/alpha/usage/summary"
const PROVIDER_ID = "commandcode" as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    message: "invalid Command Code usage",
    providerID: PROVIDER_ID,
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    message: "missing Command Code key",
    providerID: PROVIDER_ID,
  })

/** Builds an endpoint URL while stripping stale org scope from a configured base. */
function commandCodeUrl(
  baseUrl: string,
  endpoint: string,
  query: Readonly<Record<string, string | undefined>> = {}
): string {
  const url = new URL(baseUrl)
  let { pathname } = url

  while (pathname.endsWith("/")) pathname = pathname.slice(0, -1)

  url.pathname = `${pathname}${endpoint}`
  url.hash = ""
  url.searchParams.delete("orgId")

  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value)
  }

  return url.toString()
}

function keyFromAuth(value: Record<string, unknown>): string | undefined {
  const directKey = resolveCredential(
    typeof value.key === "string" ? value.key : undefined
  )
  const directApiKey = resolveCredential(
    typeof value.apiKey === "string" ? value.apiKey : undefined
  )

  if (directKey ?? directApiKey) return directKey ?? directApiKey

  const entry = value.commandcode
  if (isRecord(entry)) {
    return resolveCredential(
      typeof entry.key === "string" ? entry.key : undefined
    ) ?? resolveCredential(
      typeof entry.apiKey === "string" ? entry.apiKey : undefined
    )
  }

  return undefined
}

function whoamiReportsFailure(payload: Record<string, unknown>): boolean {
  if (payload.success === false) return true

  return (
    isRecord(payload.data) &&
    payload.data.success === false
  )
}

interface CommandCodeIdentity {
  readonly orgId?: string
}

/** Reads account scope from whoami: an org id when present, otherwise personal. */
function identityFromWhoami(payload: unknown): CommandCodeIdentity | null {
  if (!isRecord(payload) || whoamiReportsFailure(payload)) return null

  const scope = isRecord(payload.data) ? payload.data : payload
  const orgValue = scope.org ?? scope.organization

  if (orgValue !== undefined && orgValue !== null) {
    if (!isRecord(orgValue) || typeof orgValue.id !== "string" || orgValue.id.trim() === "") {
      return null
    }
    return { orgId: orgValue.id }
  }

  const { user } = scope
  if (!isRecord(user) || typeof user.id !== "string" || user.id.trim() === "") {
    return null
  }

  return {}
}

/** Converts an epoch-millisecond value into a reset instant, or null when invalid. */
function resetFromEpochMs(value: unknown): number | null {
  let epochMs: number
  try {
    epochMs = parseUsageCount(value)
  } catch {
    return null
  }

  return resetInstantOrNull(new Date(epochMs))
}

function commandCodeWindow(
  value: unknown,
  kind: UsageWindowKind,
  label: string
): UsageWindow | null {
  if (!isRecord(value)) return null

  let used: number
  let cap: number
  try {
    used = parseUsageCount(value.used)
    cap = parseUsageCount(value.cap)
  } catch {
    return null
  }

  if (cap <= 0) return null

  let quota: UsageQuota
  try {
    quota = percentageQuota(
      parseUsagePercentage(Math.min((used / cap) * 100, 100))
    )
  } catch {
    return null
  }

  return { kind, label, quota, resetsAt: resetFromEpochMs(value.resetAt) }
}

function summarySpentCredits(payload: unknown): number | null {
  if (!isRecord(payload)) return null

  try {
    return parseUsageCount(payload.totalCredits ?? payload.totalCost)
  } catch {
    return null
  }
}

function commandCodeMonthlyWindow(
  credits: unknown,
  spent: number | null
): UsageWindow | null {
  if (!isRecord(credits)) return null

  let monthly: number
  let purchased: number
  let free: number
  try {
    monthly = parseUsageCount(credits.monthlyCredits)
    purchased = parseUsageCount(credits.purchasedCredits)
    free = parseUsageCount(credits.freeCredits)
  } catch {
    return null
  }

  if (spent === null) {
    return {
      kind: "monthly",
      label: "monthly",
      quota: unknownQuota,
      resetsAt: null,
    }
  }

  const total = monthly + purchased + free + spent
  if (total <= 0) return null

  return {
    kind: "monthly",
    label: "monthly",
    quota: percentageQuota(parseUsagePercentage((spent / total) * 100)),
    resetsAt: null,
  }
}

/** Fetches and normalizes Command Code usage through the bounded JSON client. */
export async function fetchCommandCodeUsage(
  config: CommandCodeProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"commandcode">> {
  const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_BASE_URL)
  const official = officialOrigin(baseUrl, "api.commandcode.ai")

  const authFileKey = await readAuthFileCredential(
    config?.authPath,
    PROVIDER_ID,
    keyFromAuth
  )
  const configuredKey = resolveCredential(config?.apiKey)
  const authKey = isRecord(openCodeAuth) ? keyFromAuth(openCodeAuth) : undefined
  const apiKey =
    authFileKey ?? (official ? (authKey ?? configuredKey) : configuredKey)

  if (!apiKey) throw missingCredentials()

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  }

  const whoami = await requestJson({
    headers,
    method: "GET",
    providerID: PROVIDER_ID,
    timeoutMs,
    url: commandCodeUrl(baseUrl, WHOAMI_PATH, { limits: "1" }),
  })

  const identity = identityFromWhoami(whoami)
  if (!identity) throw decodeError()

  const payload = await requestJson({
    headers,
    method: "GET",
    providerID: PROVIDER_ID,
    timeoutMs,
    url: commandCodeUrl(baseUrl, CREDITS_PATH, { orgId: identity.orgId }),
  })

  if (!isRecord(payload) || !isRecord(payload.windowLimits)) throw decodeError()

  // A failed or malformed summary only removes the derived monthly window.
  let summary: unknown = null
  try {
    summary = await requestJson({
      headers,
      method: "GET",
      providerID: PROVIDER_ID,
      timeoutMs,
      url: commandCodeUrl(baseUrl, SUMMARY_PATH, { orgId: identity.orgId }),
    })
  } catch {
    summary = null
  }

  const limits = payload.windowLimits
  const windows = [
    commandCodeWindow(limits.fiveHour, "rolling", "5h"),
    commandCodeWindow(limits.weekly, "weekly", "weekly"),
    commandCodeMonthlyWindow(payload.credits, summarySpentCredits(summary)),
  ].filter((window): window is UsageWindow => window !== null)

  if (windows.length === 0) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? "Command Code",
    windows,
  }
}

/** Command Code provider adapter and OpenCode provider-ID mapping. */
export const commandCodeProvider: ProviderDefinition<"commandcode"> = {
  defaultLabel: "Command Code",
  displayOrder: 6,
  fetch: fetchCommandCodeUsage,
  footerWindowKind: "rolling",
  id: PROVIDER_ID,
  openCodeProviderIDs: [PROVIDER_ID],
}
