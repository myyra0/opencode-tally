// Codex quota adapter.

import {
  officialOrigin,
  readAuthFileObject,
  resolveCredential,
  type OpenCodeAuth,
} from "../auth.js"
import { ProviderError } from "../errors.js"
import { limitLabelForWindow } from "../format.js"
import { requestJson } from "../http.js"
import type { ProviderDefinition } from "../registry.js"
import type {
  CodexProviderConfig,
  ProviderUsage,
  UsageQuota,
  UsageWindow,
} from "../types.js"
import {
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
  unknownQuota,
} from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api"
const PROVIDER_ID = "codex" as const

interface CodexRateLimitWindow {
  readonly used_percent?: number
  readonly limit_window_seconds?: number
  /** Epoch seconds, as reported by the ChatGPT backend. */
  readonly reset_at?: number
  /** Seconds until the window resets; used when `reset_at` is absent. */
  readonly reset_after_seconds?: number
}

interface CodexRateLimit {
  readonly primary_window?: CodexRateLimitWindow
  readonly secondary_window?: CodexRateLimitWindow
}

interface CodexCredentials {
  readonly access: string
  readonly accountId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    providerID: PROVIDER_ID,
    message: "Codex response could not be decoded",
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    providerID: PROVIDER_ID,
    message: "Codex credentials are missing",
  })

function parseWindow(value: unknown): CodexRateLimitWindow | null {
  if (!isRecord(value)) return null

  const used = value.used_percent
  if (used !== undefined && typeof used !== "number") return null

  return {
    used_percent: typeof used === "number" ? used : undefined,
    limit_window_seconds:
      typeof value.limit_window_seconds === "number"
        ? value.limit_window_seconds
        : undefined,
    reset_at: typeof value.reset_at === "number" ? value.reset_at : undefined,
    reset_after_seconds:
      typeof value.reset_after_seconds === "number" &&
      Number.isFinite(value.reset_after_seconds) &&
      value.reset_after_seconds >= 0
        ? value.reset_after_seconds
        : undefined,
  }
}

function parseRateLimit(value: unknown): CodexRateLimit | undefined {
  if (!isRecord(value)) return undefined

  return {
    primary_window: isRecord(value.primary_window)
      ? (parseWindow(value.primary_window) ?? undefined)
      : undefined,
    secondary_window: isRecord(value.secondary_window)
      ? (parseWindow(value.secondary_window) ?? undefined)
      : undefined,
  }
}

function codexWindow(
  value: CodexRateLimitWindow | undefined,
  fallback: string
): UsageWindow | null {
  if (!value) return null

  let used: number | null = null
  if (value.used_percent !== undefined) {
    try {
      used = parseUsagePercentage(value.used_percent)
    } catch {
      return null
    }
  }

  const windowSeconds = value.limit_window_seconds ?? 0
  const quota: UsageQuota = used === null ? unknownQuota : percentageQuota(used)
  const resetsAt =
    value.reset_at !== undefined && value.reset_at > 0
      ? value.reset_at * 1000
      : value.reset_after_seconds !== undefined
        ? Date.now() + value.reset_after_seconds * 1000
        : null

  return {
    kind: windowSeconds > 0 ? "rolling" : "other",
    label:
      windowSeconds > 0
        ? limitLabelForWindow(windowSeconds, fallback)
        : fallback,
    quota,
    resetsAt: resetInstantOrNull(resetsAt),
  }
}

function resetCreditsFromPayload(payload: Record<string, unknown>): number | null {
  const credits = payload.rate_limit_reset_credits
  if (!isRecord(credits)) return null

  const available = credits.available_count
  return typeof available === "number" &&
    Number.isFinite(available) &&
    available >= 0
    ? available
    : null
}

const tokenFrom =
  (field: "access_token" | "account_id") =>
  (value: Record<string, unknown>): string | undefined => {
    const tokens = value.tokens
    if (!isRecord(tokens)) return undefined
    const raw = tokens[field]
    return resolveCredential(typeof raw === "string" ? raw : undefined)
  }

/** Reads the Codex CLI auth file once; either credential missing means it is unusable. */
async function readCodexAuthFile(
  authPath: string | undefined
): Promise<CodexCredentials | undefined> {
  const value = await readAuthFileObject(authPath ?? "~/.codex/auth.json")
  if (!value) return undefined

  const access = tokenFrom("access_token")(value)
  const accountId = tokenFrom("account_id")(value)
  return access !== undefined && accountId !== undefined
    ? { access, accountId }
    : undefined
}

/** Explicit auth file wins, then the configured key, then the default Codex auth file. */
async function loadFallbackCredentials(
  config: CodexProviderConfig | undefined,
  official: boolean,
  openCodeAccountId: string | undefined,
  configuredAccess: string | undefined
): Promise<CodexCredentials | undefined> {
  if (config?.authPath) {
    const fromFile = await readCodexAuthFile(config.authPath)
    if (fromFile) return fromFile
  }

  if (configuredAccess !== undefined) {
    return {
      access: configuredAccess,
      accountId: official ? (openCodeAccountId ?? "configured") : "configured",
    }
  }

  return readCodexAuthFile(undefined)
}

const CHATGPT_AUTH_CLAIM = "https://api.openai.com/auth"

/** Reads the ChatGPT account id from the access token when OpenCode did not store it. */
function accountIdFromAccessToken(access: string | undefined): string | undefined {
  if (!access) return undefined
  const parts = access.split(".")
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    const claim = isRecord(payload) && isRecord(payload[CHATGPT_AUTH_CLAIM]) ? payload[CHATGPT_AUTH_CLAIM] : undefined
    const id = claim?.chatgpt_account_id
    return typeof id === "string" && id.trim() !== "" ? id.trim() : undefined
  } catch {
    return undefined
  }
}

/** Fetches and normalizes Codex usage limits. */
export async function fetchCodexUsage(
  config: CodexProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"codex">> {
  const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_BASE_URL)
  const official = officialOrigin(baseUrl, "chatgpt.com")

  const openai = isRecord(openCodeAuth) && isRecord(openCodeAuth.openai)
    ? openCodeAuth.openai
    : undefined
  const openCodeAccess = resolveCredential(
    typeof openai?.access === "string" ? openai.access : undefined
  )
  const openCodeAccountId = resolveCredential(
    typeof openai?.accountId === "string" ? openai.accountId : undefined
  ) ?? accountIdFromAccessToken(openCodeAccess)
  const openCodeMethodID =
    typeof openai?.methodID === "string" ? openai.methodID.trim() : undefined
  const configuredAccess = resolveCredential(config?.apiKey)

  // A custom origin never receives an automatically discovered OpenCode credential.
  if (!official && !config?.authPath && configuredAccess === undefined) {
    throw missingCredentials()
  }

  // methodID === undefined only occurs for legacy auth.json entries; integration
  // entries always carry a methodID after the loader guard.
  const fromOpenCode =
    official &&
    openCodeAccess !== undefined &&
    openCodeAccountId !== undefined &&
    (openCodeMethodID === undefined ||
      openCodeMethodID === "chatgpt-browser" ||
      openCodeMethodID === "chatgpt-headless")

  const credentials = fromOpenCode
    ? { access: openCodeAccess!, accountId: openCodeAccountId! }
    : await loadFallbackCredentials(
        config,
        official,
        openCodeAccountId,
        configuredAccess
      )

  if (!credentials) throw missingCredentials()

  const request = (current: CodexCredentials): Promise<unknown> =>
    requestJson({
      url: `${baseUrl}/wham/usage`,
      headers: {
        Authorization: `Bearer ${current.access}`,
        "ChatGPT-Account-Id": current.accountId,
        "User-Agent": "opencode-tally",
      },
      method: "GET",
      providerID: PROVIDER_ID,
      timeoutMs,
    })

  let payload: unknown
  try {
    payload = await request(credentials)
  } catch (error) {
    const unauthorized =
      error instanceof ProviderError &&
      error.kind === "transport" &&
      (error.status === 401 || error.status === 403)

    if (!fromOpenCode || !unauthorized) throw error

    // Only OpenCode credentials get a single retry with the configured fallback.
    const fallback = await loadFallbackCredentials(
      config,
      official,
      openCodeAccountId,
      configuredAccess
    )
    if (!fallback) throw error
    payload = await request(fallback)
  }

  if (!isRecord(payload)) throw decodeError()

  const rateLimit = parseRateLimit(payload.rate_limit)
  const primaryWindow = codexWindow(rateLimit?.primary_window, "usage")
  const windows = [
    primaryWindow,
    codexWindow(rateLimit?.secondary_window, "secondary"),
  ].filter((window): window is UsageWindow => window !== null)

  if (!primaryWindow) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? "Codex",
    metadata: { resetCredits: resetCreditsFromPayload(payload) },
    tierName: typeof payload.plan_type === "string" ? payload.plan_type : undefined,
    windows,
  }
}

/** Plugin registration for the Codex adapter. */
export const codexProvider: ProviderDefinition<"codex"> = {
  defaultLabel: "Codex",
  displayOrder: 0,
  fetch: fetchCodexUsage,
  footerWindowKind: "rolling",
  id: "codex",
  openCodeProviderIDs: ["openai"],
}
