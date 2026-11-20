// MiniMax Token Plan window adapter.

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
  MiniMaxProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "../types.js"
import { parseUsagePercentage, percentageQuota, resetInstantOrNull } from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

const DEFAULT_MINIMAX_BASE_URL = "https://www.minimax.io"
const MINIMAX_TOKEN_PLAN_PATH = "/v1/token_plan/remains"
const OFFICIAL_HOSTS = new Set(["www.minimax.io", "api.minimaxi.com"])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

interface MiniMaxModelEntry {
  readonly currentIntervalRemainingPercent?: number
  readonly currentIntervalStatus?: number
  readonly currentWeeklyRemainingPercent?: number
  readonly currentWeeklyStatus?: number
  readonly modelName?: string
  readonly remainsTime?: number
  readonly weeklyRemainsTime?: number
}

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    message: "MiniMax response could not be decoded",
    providerID: "minimax",
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    message: "MiniMax credentials are missing",
    providerID: "minimax",
  })

/** Reads the first recognized key from any supported auth object shape. */
function keyFromMiniMaxAuth(value: Record<string, unknown>): string | undefined {
  const from = (candidate: unknown): string | undefined => {
    if (!isRecord(candidate)) return undefined
    return (
      resolveCredential(typeof candidate.key === "string" ? candidate.key : undefined) ??
      resolveCredential(
        typeof candidate.apiKey === "string" ? candidate.apiKey : undefined
      )
    )
  }

  return (
    from(value) ??
    from(value["minimax-coding-plan"]) ??
    from(value.minimax) ??
    from(value["minimax-token-plan"])
  )
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/** Validates the success envelope and returns filtered per-model entries. */
function parseMiniMaxModelRemains(payload: unknown): MiniMaxModelEntry[] {
  if (!isRecord(payload)) throw decodeError()

  const baseResp = isRecord(payload.base_resp) ? payload.base_resp : undefined
  const statusCode = baseResp?.status_code
  const statusMsg = baseResp?.status_msg
  const baseRespOk =
    (statusCode === 0 || statusCode === null || statusCode === undefined) &&
    statusMsg === "success"

  if (!baseRespOk || !Array.isArray(payload.model_remains)) throw decodeError()

  return payload.model_remains.flatMap((entry): MiniMaxModelEntry[] => {
    if (!isRecord(entry)) return []

    return [
      {
        currentIntervalRemainingPercent: asNumber(
          entry.current_interval_remaining_percent
        ),
        currentIntervalStatus: asNumber(entry.current_interval_status),
        currentWeeklyRemainingPercent: asNumber(
          entry.current_weekly_remaining_percent
        ),
        currentWeeklyStatus: asNumber(entry.current_weekly_status),
        modelName: typeof entry.model_name === "string" ? entry.model_name : undefined,
        remainsTime: asNumber(entry.remains_time),
        weeklyRemainsTime: asNumber(entry.weekly_remains_time),
      },
    ]
  })
}

/** Prefers the canonical `general` entry, then the first in-plan entry. */
function selectMiniMaxEntry(entries: readonly MiniMaxModelEntry[]): MiniMaxModelEntry | null {
  const general = entries.find((entry) => entry.modelName === "general")
  if (general) return general

  return (
    entries.find(
      (entry) =>
        entry.currentIntervalStatus === 1 &&
        entry.currentIntervalRemainingPercent !== undefined
    ) ?? null
  )
}

const tryPercent = (value: unknown): number | null => {
  try {
    return parseUsagePercentage(value)
  } catch {
    return null
  }
}

function windowFromRemaining(
  remainingPercent: number | null,
  remainsMs: number | undefined,
  now: number,
  label: "5h" | "weekly",
  kind: "rolling" | "weekly"
): UsageWindow | null {
  if (remainingPercent === null) return null

  const used = tryPercent(100 - remainingPercent)
  if (used === null) return null

  return {
    kind,
    label,
    quota: percentageQuota(used),
    resetsAt: resetInstantOrNull(
      remainsMs === undefined ? null : now + remainsMs
    ),
  }
}

/** Fetches MiniMax Token Plan quota windows. */
export async function fetchMiniMaxTokenPlanUsage(
  config: MiniMaxProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"minimax">> {
  const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_MINIMAX_BASE_URL)
  const official = [...OFFICIAL_HOSTS].some((host) => officialOrigin(baseUrl, host))
  const configuredKey = resolveCredential(config?.apiKey)

  const authFileKey = await readAuthFileCredential(
    config?.authPath,
    "minimax",
    keyFromMiniMaxAuth
  )
  const authKey = keyFromMiniMaxAuth(openCodeAuth as Record<string, unknown>)
  const apiKey = authFileKey ?? pickCredential({
    official,
    discovered: authKey,
    configured: configuredKey,
  })

  if (!apiKey) throw missingCredentials()

  const payload = await requestJson({
    url: `${baseUrl}${MINIMAX_TOKEN_PLAN_PATH}`,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "GET",
    providerID: "minimax",
    timeoutMs,
  })

  const selected = selectMiniMaxEntry(parseMiniMaxModelRemains(payload))
  if (!selected) throw decodeError()

  const capturedAt = Date.now()
  const windows: UsageWindow[] = []
  const fiveHour =
    selected.currentIntervalStatus === 3
      ? null
      : windowFromRemaining(
          tryPercent(selected.currentIntervalRemainingPercent),
          selected.remainsTime,
          capturedAt,
          "5h",
          "rolling"
        )
  if (fiveHour) windows.push(fiveHour)

  const weekly =
    selected.currentWeeklyStatus === 3
      ? null
      : windowFromRemaining(
          tryPercent(selected.currentWeeklyRemainingPercent),
          selected.weeklyRemainsTime,
          capturedAt,
          "weekly",
          "weekly"
        )
  if (weekly) windows.push(weekly)

  if (!fiveHour) throw decodeError()

  return {
    capturedAt,
    id: "minimax",
    label: config?.label ?? "MiniMax",
    windows,
  }
}

/** MiniMax Token Plan adapter and OpenCode provider-ID mapping. */
export const minimaxProvider: ProviderDefinition<"minimax"> = {
  defaultLabel: "MiniMax",
  displayOrder: 3,
  fetch: fetchMiniMaxTokenPlanUsage,
  footerWindowKind: "rolling",
  id: "minimax",
  openCodeProviderIDs: ["minimax-coding-plan", "minimax"],
}
