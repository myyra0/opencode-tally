// Lazy, per-process quota snapshot cache. Config is reloaded on every call; network fetches
// are gated by the configured TTL and deduplicated per provider through in-flight promises.

import { DEFAULT_QUOTA_CONFIG, loadQuotaConfig } from "../config.js"
import { loadOpenCodeAuth, type OpenCodeAuth } from "./auth.js"
import { ProviderError } from "./errors.js"
import {
  PROVIDER_REGISTRY,
  REFERENCE_PROVIDER_ORDER,
  displayOrderFor,
  isProviderID,
} from "./registry.js"
import type {
  ProviderConfig,
  ProviderDisplayConfig,
  ProviderID,
  ProviderState,
  ProviderUsage,
  QuotaConfig,
  QuotaView,
} from "./types.js"

export interface QuotaSnapshotOptions {
  now?: () => number
  loadConfig?: () => Promise<{ value: QuotaConfig; diagnostics: string[] }>
  loadAuth?: () => Promise<{ auth: OpenCodeAuth; diagnostic?: string }>
  fetchProvider?: <ID extends ProviderID>(
    id: ID,
    config: any,
    auth: OpenCodeAuth,
    timeoutMs: number,
  ) => Promise<ProviderUsage<ID>>
}

interface FetchResult {
  usage: ProviderUsage | undefined
  error: unknown
}

interface ProviderCacheEntry {
  lastSuccess: ProviderUsage | null
  lastState: ProviderState | null
  lastFetchAt: number | null
  inFlight: Promise<FetchResult> | null
}

interface SnapshotCache {
  providers: Map<ProviderID, ProviderCacheEntry>
  updatedAt: number | null
}

type ErrorState = Extract<ProviderState, { status: "error" }>

const createEntry = (): ProviderCacheEntry => ({
  lastSuccess: null,
  lastState: null,
  lastFetchAt: null,
  inFlight: null,
})

let cache: SnapshotCache = { providers: new Map(), updatedAt: null }

/** Clears all cached quota state. Intended for tests. */
export function resetQuotaSnapshotCache(): void {
  cache = { providers: new Map(), updatedAt: null }
}

/** Recursively drops undefined properties so the RPC payload survives a JSON round-trip. */
function jsonSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item)) as T

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) result[key] = jsonSafe(item)
    }
    return result as T
  }

  return value
}

const registryFetch: NonNullable<QuotaSnapshotOptions["fetchProvider"]> = async (
  id,
  config,
  auth,
  timeoutMs,
) => {
  const definition = PROVIDER_REGISTRY[id]
  if (!definition) throw new Error("Provider is not available")
  return definition.fetch(config, auth, timeoutMs)
}

function errorState(id: ProviderID, label: string, error: unknown, previous: ProviderUsage | null): ErrorState {
  const errorKind = error instanceof ProviderError ? error.kind : undefined
  // Only typed adapter errors carry a user-facing message; other failures stay generic.
  const message = error instanceof ProviderError ? error.message : "Usage unavailable"
  const state: ErrorState = { id, label, status: "error", message }
  if (errorKind !== undefined) state.errorKind = errorKind
  if (previous !== null) state.previous = previous
  return state
}

function withStaleFlag(state: ProviderState, nowMs: number, staleAfterMs: number): ProviderState {
  return state.status === "ready"
    ? { ...state, stale: nowMs - state.data.capturedAt > staleAfterMs }
    : state
}

function configuredProviders(
  config: QuotaConfig,
  allowUnregistered: boolean,
): Array<[ProviderID, ProviderConfig]> {
  return REFERENCE_PROVIDER_ORDER.flatMap((id) => {
    const providerConfig = config.providers[id]
    if (providerConfig?.enabled !== true) return []
    // Without an injected fetcher there is no adapter to call yet: skip, never invent usage.
    if (!allowUnregistered && !isProviderID(id)) return []
    return [[id, providerConfig] as [ProviderID, ProviderConfig]]
  }).sort((left, right) => displayOrderFor(left[0]) - displayOrderFor(right[0]))
}

/**
 * Builds a JSON-safe quota view from the current config. The provider list reflects config
 * changes immediately, while actual fetches only run once per `refreshIntervalSeconds`.
 * Never throws: config, auth, and provider failures become diagnostics or provider states.
 */
export async function getQuotaSnapshot(options: QuotaSnapshotOptions = {}): Promise<QuotaView> {
  const now = options.now ?? Date.now
  const loadConfig = options.loadConfig ?? loadQuotaConfig
  const loadAuth = options.loadAuth ?? loadOpenCodeAuth
  const fetchProvider = options.fetchProvider ?? registryFetch
  const diagnostics: string[] = []

  let config: QuotaConfig
  try {
    const loaded = await loadConfig()
    config = loaded.value
    diagnostics.push(...loaded.diagnostics)
  } catch {
    config = { ...DEFAULT_QUOTA_CONFIG }
    diagnostics.push("Quota configuration could not be loaded")
  }

  const intervalMs = Math.max(15, config.refreshIntervalSeconds) * 1000
  const staleAfterMs = intervalMs * 2
  const startedAt = now()
  const providers = config.enabled
    ? configuredProviders(config, options.fetchProvider !== undefined)
    : []
  const enabledIDs = new Set(providers.map(([id]) => id))

  for (const id of Array.from(cache.providers.keys())) {
    if (!enabledIDs.has(id)) cache.providers.delete(id)
  }
  for (const [id] of providers) {
    if (!cache.providers.has(id)) cache.providers.set(id, createEntry())
  }

  const providerDisplays: Partial<Record<ProviderID, ProviderDisplayConfig>> = {}
  for (const [id, providerConfig] of providers) {
    providerDisplays[id] = {
      showSidebarBar: providerConfig.showSidebarBar ?? true,
      sidebarWindow: providerConfig.sidebarWindow ?? "all",
      showFooterBar: providerConfig.showFooterBar ?? true,
      footerWindow: providerConfig.footerWindow ?? "auto",
    }
  }

  const pending = providers.filter(([id]) => {
    const entry = cache.providers.get(id)!
    return entry.lastFetchAt === null || startedAt - entry.lastFetchAt >= intervalMs
  })

  let auth: OpenCodeAuth = {}
  if (pending.length > 0) {
    try {
      const loaded = await loadAuth()
      auth = loaded.auth
      if (loaded.diagnostic) diagnostics.push(loaded.diagnostic)
    } catch {
      diagnostics.push("OpenCode auth could not be read")
    }
  }

  const results = new Map<ProviderID, FetchResult>()
  if (pending.length > 0) {
    await Promise.all(pending.map(async ([id, providerConfig]) => {
      // A concurrent call may have removed this provider while auth was loading.
      const entry = cache.providers.get(id)
      if (!entry) return
      let inFlight = entry.inFlight
      if (!inFlight) {
        entry.lastFetchAt = startedAt
        inFlight = (async () => {
          try {
            const data = await fetchProvider(id, providerConfig, auth, config.requestTimeoutMs)
            return { usage: data, error: undefined }
          } catch (error) {
            return { usage: undefined, error }
          }
        })()
        entry.inFlight = inFlight
      }
      try {
        results.set(id, await inFlight)
      } finally {
        if (entry.inFlight === inFlight) entry.inFlight = null
      }
    }))
  }

  const completedAt = now()
  const states: ProviderState[] = []
  for (const [id, providerConfig] of providers) {
    // Another call may have removed this provider from config while our fetch was in flight.
    const entry = cache.providers.get(id)
    if (!entry) continue
    const label = providerConfig.label ?? PROVIDER_REGISTRY[id]?.defaultLabel ?? id
    let state: ProviderState

    const result = results.get(id)
    if (result) {
      if (result.usage !== undefined) {
        entry.lastSuccess = result.usage
        state = { id, label, status: "ready", data: result.usage, stale: false }
      } else {
        state = errorState(id, label, result.error, entry.lastSuccess)
      }
      entry.lastState = state
    } else if (entry.lastState) {
      state = { ...entry.lastState, label }
    } else {
      state = { id, label, status: "loading" }
      entry.lastState = state
    }

    state = withStaleFlag(state, completedAt, staleAfterMs)
    entry.lastState = state
    states.push(state)
  }

  if (pending.length > 0) cache.updatedAt = completedAt

  return jsonSafe({
    states,
    providerDisplays,
    diagnostics,
    updatedAt: cache.updatedAt,
    showErrors: config.showErrors,
  })
}
