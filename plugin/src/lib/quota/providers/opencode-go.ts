// OpenCode GO quota adapter.

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
  OpenCodeGoProviderConfig,
  ProviderUsage,
  UsageQuota,
  UsageWindow,
  UsageWindowKind,
} from "../types.js"
import { parseUsagePercentage, percentageQuota, resetInstantOrNull } from "../usage.js"
import { resolveHttpsBaseUrl } from "../url.js"

const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"
const PROVIDER_ID = "opencode-go" as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    providerID: PROVIDER_ID,
    message: "OpenCode GO response could not be decoded",
  })

/** Looks up a key in the provider entry, the opencode alias, then direct fields. */
function keyFromAuth(value: Record<string, unknown>): string | undefined {
  const fromEntry = (candidate: unknown): string | undefined => {
    if (!isRecord(candidate)) return undefined
    return resolveCredential(
      typeof candidate.key === "string" ? candidate.key : undefined
    ) ?? resolveCredential(
      typeof candidate.apiKey === "string" ? candidate.apiKey : undefined
    )
  }

  return (
    fromEntry(value[PROVIDER_ID]) ??
    fromEntry(value.opencode) ??
    fromEntry(value)
  )
}

function goWindow(
  value: unknown,
  kind: UsageWindowKind,
  label: string
): UsageWindow | null {
  if (!isRecord(value)) return null

  let quota: UsageQuota
  try {
    quota = percentageQuota(parseUsagePercentage(value.percent))
  } catch {
    return null
  }

  return {
    kind,
    label,
    quota,
    resetsAt: resetInstantOrNull(
      typeof value.resetsAt === "string" ? value.resetsAt : null
    ),
  }
}

/** Fetches and normalizes OpenCode GO usage windows. */
export async function fetchOpenCodeGoUsage(
  config: OpenCodeGoProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"opencode-go">> {
  const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_BASE_URL)
  const official = officialOrigin(baseUrl, "opencode.ai")

  const authPathKey = await readAuthFileCredential(
    config?.authPath,
    PROVIDER_ID,
    keyFromAuth
  )
  const configuredKey = resolveCredential(config?.apiKey)
  const authKey = isRecord(openCodeAuth) ? keyFromAuth(openCodeAuth) : undefined
  const apiKey = authPathKey ?? (official ? (authKey ?? configuredKey) : configuredKey)

  if (!apiKey) {
    throw new ProviderError({
      kind: "missing_credentials",
      providerID: PROVIDER_ID,
      message: "OpenCode GO credentials are missing",
    })
  }

  const payload = await requestJson({
    url: `${baseUrl}/usage`,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    method: "GET",
    providerID: PROVIDER_ID,
    timeoutMs,
  })

  const rawUsage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : null
  if (!rawUsage) throw decodeError()

  const windows = [
    goWindow(rawUsage.rolling, "rolling", "rolling"),
    goWindow(rawUsage.weekly, "weekly", "weekly"),
    goWindow(rawUsage.monthly, "monthly", "monthly"),
  ].filter((window): window is UsageWindow => window !== null)

  if (windows.length === 0) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? "OpenCode GO",
    windows,
  }
}

/** Plugin registration for the OpenCode GO adapter. */
export const openCodeGoProvider: ProviderDefinition<"opencode-go"> = {
  defaultLabel: "OpenCode GO",
  displayOrder: 5,
  fetch: fetchOpenCodeGoUsage,
  footerWindowKind: "rolling",
  id: "opencode-go",
  openCodeProviderIDs: ["opencode-go"],
}
