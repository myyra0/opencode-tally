// Moonshot and Kimi balance adapters.

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
  MoonshotAiProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "../types.js"
import { balanceQuota } from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

type MoonshotID = "moonshotai" | "moonshotai-cn"

interface MoonshotRegion<ID extends MoonshotID> {
  readonly baseUrl: string
  readonly currency: "CNY" | "USD"
  readonly id: ID
  readonly label: string
}

type MoonshotFetch<ID extends MoonshotID> = (
  config: MoonshotAiProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
) => Promise<ProviderUsage<ID>>

const regions = {
  moonshotai: {
    baseUrl: "https://api.moonshot.ai",
    currency: "USD",
    id: "moonshotai",
    label: "Moonshot AI",
  },
  "moonshotai-cn": {
    baseUrl: "https://api.moonshot.cn",
    currency: "CNY",
    id: "moonshotai-cn",
    label: "Moonshot AI CN",
  },
} as const satisfies {
  moonshotai: MoonshotRegion<"moonshotai">
  "moonshotai-cn": MoonshotRegion<"moonshotai-cn">
}

const BALANCE_PATH = "/v1/users/me/balance"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (id: MoonshotID): ProviderError =>
  new ProviderError({
    kind: "decode",
    providerID: id,
    message: "Moonshot response could not be decoded",
  })

const missingCredentials = (id: MoonshotID): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    providerID: id,
    message: `${id === "moonshotai" ? "Moonshot AI" : "Moonshot AI CN"} credentials are missing`,
  })

/** Reads the authoritative available balance only from a successful envelope. */
function parseMoonshotBalance(payload: unknown): number | null {
  if (!isRecord(payload) || payload.code !== 0 || payload.status !== true) {
    return null
  }

  if (!isRecord(payload.data)) return null

  const amount = payload.data.available_balance

  return typeof amount === "number" && Number.isFinite(amount) ? amount : null
}

/** Appends the balance path after any configured path, keeping the query but dropping the fragment. */
function balanceUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/u, "")}${BALANCE_PATH}`
  url.hash = ""

  return url.toString()
}

function balanceWindow(
  amount: number,
  region: MoonshotRegion<MoonshotID>
): UsageWindow {
  return {
    kind: "credits",
    label: `${region.currency} balance`,
    quota: balanceQuota(amount, region.currency),
    resetsAt: null,
  }
}

function createFetch<ID extends MoonshotID>(
  region: MoonshotRegion<ID>
): MoonshotFetch<ID> {
  return async function fetchMoonshotBalanceUsage(
    config: MoonshotAiProviderConfig | undefined,
    openCodeAuth: OpenCodeAuth,
    timeoutMs: number
  ): Promise<ProviderUsage<ID>> {
    const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, region.baseUrl)
    const official = officialOrigin(baseUrl, new URL(region.baseUrl).hostname)

    const authFileKey = await readAuthFileCredential(config?.authPath, region.id)
    const configuredKey = resolveCredential(config?.apiKey)

    const entry = openCodeAuth?.[region.id]
    const authKey = entry
      ? resolveCredential(entry.key) ?? resolveCredential(entry.apiKey)
      : undefined

    // A custom origin never receives an automatically discovered OpenCode credential,
    // and a region never borrows the other region's key.
    const apiKey =
      authFileKey ??
      pickCredential({ official, discovered: authKey, configured: configuredKey })

    if (!apiKey) throw missingCredentials(region.id)

    const payload = await requestJson({
      url: balanceUrl(baseUrl),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      method: "GET",
      providerID: region.id,
      timeoutMs,
    })

    const amount = parseMoonshotBalance(payload)
    if (amount === null) throw decodeError(region.id)

    return {
      capturedAt: Date.now(),
      id: region.id,
      label: config?.label ?? region.label,
      windows: [balanceWindow(amount, region)],
    }
  }
}

function createProvider<ID extends MoonshotID>(
  region: MoonshotRegion<ID>,
  fetch: MoonshotFetch<ID>
): ProviderDefinition<ID> {
  return {
    defaultLabel: region.label,
    displayOrder: region.id === "moonshotai" ? 11 : 12,
    fetch,
    footerWindowKind: "credits",
    id: region.id,
    openCodeProviderIDs: [region.id],
  }
}

const globalFetch = createFetch(regions.moonshotai)
const chinaFetch = createFetch(regions["moonshotai-cn"])

/** Fetches the global Moonshot/Kimi API balance. */
export const fetchMoonshotAiBalanceUsage = globalFetch
/** Fetches the China Moonshot/Kimi API balance. */
export const fetchMoonshotAiCnBalanceUsage = chinaFetch

/** Moonshot AI and Moonshot AI CN balance provider adapters and OpenCode mappings. */
export const moonshotAiProvider = createProvider(regions.moonshotai, globalFetch)
export const moonshotAiCnProvider = createProvider(regions["moonshotai-cn"], chinaFetch)
