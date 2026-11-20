// DeepSeek balance adapter.

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
  DeepSeekProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "../types.js"
import { balanceQuota } from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

const DEFAULT_BASE_URL = "https://api.deepseek.com"
const BALANCE_PATH = "/user/balance"
const PROVIDER_ID = "deepseek" as const
const DECIMAL_STRING = /^\d+(?:\.\d+)?$/u

interface DeepSeekBalanceInfo {
  readonly currency: string
  readonly totalBalance: number
}

interface DeepSeekPayload {
  readonly isAvailable: boolean
  readonly balances: readonly DeepSeekBalanceInfo[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    providerID: PROVIDER_ID,
    message: "DeepSeek response could not be decoded",
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    providerID: PROVIDER_ID,
    message: "DeepSeek credentials are missing",
  })

/** Reads a decimal-string balance, rejecting underflow and non-canonical spellings. */
function parseDecimalBalance(value: unknown): number | null {
  if (typeof value !== "string" || !DECIMAL_STRING.test(value)) {
    return null
  }

  const parsed = Number(value)

  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    (parsed === 0 && /[1-9]/u.test(value))
  ) {
    return null
  }

  return parsed
}

function parseDeepSeekBalanceInfo(value: unknown): DeepSeekBalanceInfo | null {
  if (!isRecord(value) || typeof value.currency !== "string") {
    return null
  }

  const currency = value.currency.trim()
  const totalBalance = parseDecimalBalance(value.total_balance)

  if (currency === "" || totalBalance === null) {
    return null
  }

  return { currency, totalBalance }
}

function parseDeepSeekPayload(value: Record<string, unknown>): DeepSeekPayload | null {
  if (typeof value.is_available !== "boolean" || !Array.isArray(value.balance_infos)) {
    return null
  }

  const balances = value.balance_infos.flatMap((entry) => {
    const parsed = parseDeepSeekBalanceInfo(entry)
    return parsed ? [parsed] : []
  })

  return { balances, isAvailable: value.is_available }
}

/** Appends the balance path after any configured path, keeping the query but dropping the fragment. */
function balanceUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/u, "")}${BALANCE_PATH}`
  url.hash = ""

  return url.toString()
}

function balanceWindow(balance: DeepSeekBalanceInfo): UsageWindow {
  return {
    kind: "credits",
    label: balance.currency,
    quota: balanceQuota(balance.totalBalance, balance.currency),
    resetsAt: null,
  }
}

/** Fetches and normalizes DeepSeek currency balances. */
export async function fetchDeepSeekBalanceUsage(
  config: DeepSeekProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"deepseek">> {
  const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_BASE_URL)
  const official = officialOrigin(baseUrl, "api.deepseek.com")

  const authFileKey = await readAuthFileCredential(config?.authPath, PROVIDER_ID)
  const configuredKey = resolveCredential(config?.apiKey)

  const entry = openCodeAuth?.deepseek
  const authKey = entry
    ? resolveCredential(entry.key) ?? resolveCredential(entry.apiKey)
    : undefined

  // A custom origin never receives an automatically discovered OpenCode credential.
  const apiKey =
    authFileKey ??
    pickCredential({ official, discovered: authKey, configured: configuredKey })

  if (!apiKey) throw missingCredentials()

  const payload = await requestJson({
    url: balanceUrl(baseUrl),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    method: "GET",
    providerID: PROVIDER_ID,
    timeoutMs,
  })

  const parsed = isRecord(payload) ? parseDeepSeekPayload(payload) : null
  if (!parsed || parsed.balances.length === 0) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? "DeepSeek",
    metadata: { isAvailable: parsed.isAvailable },
    windows: parsed.balances.map(balanceWindow),
  }
}

/** DeepSeek balance provider adapter and OpenCode provider-ID mapping. */
export const deepSeekProvider: ProviderDefinition<"deepseek"> = {
  defaultLabel: "DeepSeek",
  displayOrder: 8,
  fetch: fetchDeepSeekBalanceUsage,
  footerWindowKind: "credits",
  id: "deepseek",
  openCodeProviderIDs: ["deepseek"],
}
