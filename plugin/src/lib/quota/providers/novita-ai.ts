// Novita AI balance adapter.

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
  NovitaAiProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "../types.js"
import { balanceQuota } from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

const DEFAULT_BASE_URL = "https://api.novita.ai"
const BALANCE_PATH = "/openapi/v1/billing/balance/detail"
const PROVIDER_ID = "novita-ai" as const
const MINOR_UNIT_STRING = /^\d+$/u
const MAX_SAFE_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    providerID: PROVIDER_ID,
    message: "Novita AI response could not be decoded",
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    providerID: PROVIDER_ID,
    message: "Novita AI credentials are missing",
  })

/** Converts Novita's integer ten-thousandths-of-a-dollar amount to USD. */
function parseAvailableBalance(value: unknown): number | null {
  if (typeof value !== "string" || !MINOR_UNIT_STRING.test(value)) {
    return null
  }

  const normalized = value.replace(/^0+/u, "") || "0"

  if (normalized.length > String(Number.MAX_SAFE_INTEGER).length) {
    return null
  }

  const minorUnits = BigInt(normalized)
  if (minorUnits > MAX_SAFE_MINOR_UNITS) return null

  return Number(minorUnits) / 10_000
}

/** Appends the balance path after any configured path, keeping the query but dropping the fragment. */
function balanceUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/u, "")}${BALANCE_PATH}`
  url.hash = ""

  return url.toString()
}

function balanceWindow(amount: number): UsageWindow {
  return {
    kind: "credits",
    label: "balance",
    quota: balanceQuota(amount, "USD"),
    resetsAt: null,
  }
}

/** Fetches and normalizes Novita AI's available USD balance. */
export async function fetchNovitaAiBalanceUsage(
  config: NovitaAiProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"novita-ai">> {
  const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_BASE_URL)
  const official = officialOrigin(baseUrl, "api.novita.ai")

  const authFileKey = await readAuthFileCredential(config?.authPath, PROVIDER_ID)
  const configuredKey = resolveCredential(config?.apiKey)

  const entry = openCodeAuth?.[PROVIDER_ID]
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

  const amount = isRecord(payload)
    ? parseAvailableBalance(payload.availableBalance)
    : null
  if (amount === null) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? "Novita AI",
    windows: [balanceWindow(amount)],
  }
}

/** Novita AI balance adapter and OpenCode provider-ID mapping. */
export const novitaAiProvider: ProviderDefinition<"novita-ai"> = {
  defaultLabel: "Novita AI",
  displayOrder: 9,
  fetch: fetchNovitaAiBalanceUsage,
  footerWindowKind: "credits",
  id: "novita-ai",
  openCodeProviderIDs: ["novita-ai"],
}
