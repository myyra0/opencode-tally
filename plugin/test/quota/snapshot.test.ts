import { beforeEach, expect, test } from "bun:test"

import { ProviderError } from "../../src/lib/quota/errors.js"
import {
  getQuotaSnapshot,
  resetQuotaSnapshotCache,
  type QuotaSnapshotOptions,
} from "../../src/lib/quota/snapshot.js"
import type { OpenCodeAuth } from "../../src/lib/quota/auth.js"
import type { ProviderID, ProviderUsage, QuotaConfig } from "../../src/lib/quota/types.js"

const INTERVAL_SECONDS = 60
const TTL_MS = INTERVAL_SECONDS * 1000
const START = 1_700_000_000_000

type FetchCall = { id: ProviderID; config: unknown; auth: OpenCodeAuth; timeoutMs: number }

let clock: number
let calls: FetchCall[]

beforeEach(() => {
  resetQuotaSnapshotCache()
  clock = START
  calls = []
})

function config(providers: QuotaConfig["providers"], overrides: Partial<QuotaConfig> = {}): QuotaConfig {
  return {
    enabled: true,
    refreshIntervalSeconds: INTERVAL_SECONDS,
    requestTimeoutMs: 2500,
    showErrors: true,
    providers,
    ...overrides,
  }
}

function usage(id: ProviderID, capturedAt: number, usedPercent = 10): ProviderUsage {
  return {
    id,
    label: id,
    capturedAt,
    windows: [
      {
        kind: "rolling",
        label: "Rolling",
        quota: { _tag: "Percentage", remainingPercent: 100 - usedPercent, usedPercent },
        resetsAt: null,
      },
    ],
  }
}

function options(
  loadConfig: QuotaSnapshotOptions["loadConfig"],
  fetchProvider: QuotaSnapshotOptions["fetchProvider"],
  loadAuth: QuotaSnapshotOptions["loadAuth"] = async () => ({ auth: {} }),
): QuotaSnapshotOptions {
  return {
    now: () => clock,
    loadConfig,
    loadAuth,
    fetchProvider,
  }
}

function recordingFetcher(overrides: Partial<Record<ProviderID, (id: ProviderID) => Promise<ProviderUsage>>> = {}) {
  return (async (id: ProviderID, providerConfig: unknown, auth: OpenCodeAuth, timeoutMs: number) => {
    calls.push({ id, config: providerConfig, auth, timeoutMs })
    const override = overrides[id]
    if (override) return override(id)
    return usage(id, clock)
  }) as QuotaSnapshotOptions["fetchProvider"]
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

test("first call fetches enabled providers and returns ready states in reference order", async () => {
  const value = config({
    "opencode-go": { enabled: true },
    codex: { enabled: true, showSidebarBar: false, sidebarWindow: "daily", showFooterBar: false, footerWindow: "credits" },
    zai: { enabled: false },
  })
  const opts = options(async () => ({ value, diagnostics: [] }), recordingFetcher())

  const view = await getQuotaSnapshot(opts)

  expect(calls.map((call) => call.id)).toEqual(["codex", "opencode-go"])
  expect(calls[0]?.timeoutMs).toBe(2500)
  expect(view.states.map((state) => state.id)).toEqual(["codex", "opencode-go"])
  expect(view.states[0]).toMatchObject({ id: "codex", status: "ready", stale: false })
  expect(view.states[1]).toMatchObject({ id: "opencode-go", status: "ready", stale: false })
  expect(view.updatedAt).toBe(START)
  expect(view.diagnostics).toEqual([])
  expect(view.showErrors).toBe(true)
  expect(view.providerDisplays.codex).toEqual({
    showSidebarBar: false,
    sidebarWindow: "daily",
    showFooterBar: false,
    footerWindow: "credits",
  })
  expect(view.providerDisplays["opencode-go"]).toEqual({
    showSidebarBar: true,
    sidebarWindow: "all",
    showFooterBar: true,
    footerWindow: "auto",
  })
  expect(view.providerDisplays.zai).toBeUndefined()
})

test("a second call inside the TTL reuses cached states without refetching", async () => {
  let value = config({ codex: { enabled: true }, "opencode-go": { enabled: true } })
  let configDiagnostics: string[] = []
  const opts = options(
    async () => ({ value, diagnostics: configDiagnostics }),
    recordingFetcher(),
  )

  const first = await getQuotaSnapshot(opts)
  const firstCalls = calls.length
  calls = []
  clock += 1000
  configDiagnostics = ["fresh diagnostic"]
  const second = await getQuotaSnapshot(opts)

  expect(firstCalls).toBe(2)
  expect(calls).toHaveLength(0)
  expect(second.states).toEqual(first.states)
  expect(second.updatedAt).toBe(first.updatedAt)
  // config is still reloaded on every call; only the network fetch is gated by the TTL.
  expect(second.diagnostics).toEqual(["fresh diagnostic"])
})

test("config add/remove applies immediately within the TTL and new providers fetch right away", async () => {
  let value = config({ codex: { enabled: true }, "opencode-go": { enabled: true } })
  const opts = options(async () => ({ value, diagnostics: [] }), recordingFetcher())

  await getQuotaSnapshot(opts)
  expect(calls.map((call) => call.id)).toEqual(["codex", "opencode-go"])

  calls = []
  value = config({ codex: { enabled: true }, zai: { enabled: true } })
  const view = await getQuotaSnapshot(opts)

  expect(view.states.map((state) => state.id)).toEqual(["codex", "zai"])
  expect(calls.map((call) => call.id)).toEqual(["zai"])
})

test("after the TTL a changed config adds and removes providers", async () => {
  let value = config({ codex: { enabled: true }, "opencode-go": { enabled: true } })
  const opts = options(async () => ({ value, diagnostics: [] }), recordingFetcher())

  await getQuotaSnapshot(opts)
  calls = []
  clock += TTL_MS + 1
  value = config({ codex: { enabled: true }, zai: { enabled: true } })
  const view = await getQuotaSnapshot(opts)

  expect(calls.map((call) => call.id)).toEqual(["codex", "zai"])
  expect(view.states.map((state) => state.id)).toEqual(["codex", "zai"])
  expect(view.updatedAt).toBe(clock)
})

test("a provider that fails after succeeding keeps its previous data", async () => {
  const value = config({ codex: { enabled: true } })
  let shouldFail = false
  const fetcher = recordingFetcher({
    codex: async (id) => {
      if (shouldFail) throw new Error("secret upstream detail")
      return usage(id, clock, 20)
    },
  })
  const opts = options(async () => ({ value, diagnostics: [] }), fetcher)

  const first = await getQuotaSnapshot(opts)
  expect(first.states[0]).toMatchObject({ status: "ready", stale: false })
  const firstData = first.states[0] as Extract<(typeof first.states)[number], { status: "ready" }>

  shouldFail = true
  clock += TTL_MS + 1
  const second = await getQuotaSnapshot(opts)
  const failed = second.states[0] as Extract<(typeof second.states)[number], { status: "error" }>

  expect(failed.status).toBe("error")
  expect(failed.message).toBe("Usage unavailable")
  expect(failed.previous).toEqual(firstData.data)
  expect(failed.errorKind).toBeUndefined()
  // The refresh completed even though the provider failed.
  expect(second.updatedAt).toBe(clock)
})

test("a ready provider whose data is older than twice the interval is stale", async () => {
  const value = config({ codex: { enabled: true } })
  const fetcher = recordingFetcher({ codex: async (id) => usage(id, clock - 2 * TTL_MS - 1) })
  const view = await getQuotaSnapshot(options(async () => ({ value, diagnostics: [] }), fetcher))

  expect(view.states[0]).toMatchObject({ status: "ready", stale: true })
})

test("a never-successful provider returns an error state with no previous data", async () => {
  const value = config({ codex: { enabled: true } })
  const fetcher = (async () => {
    throw new ProviderError({ kind: "transport", providerID: "codex", message: "Request failed" })
  }) as QuotaSnapshotOptions["fetchProvider"]
  const view = await getQuotaSnapshot(options(async () => ({ value, diagnostics: [] }), fetcher))
  const state = view.states[0] as Extract<(typeof view.states)[number], { status: "error" }>

  expect(state).toMatchObject({ status: "error", message: "Request failed", errorKind: "transport" })
  expect(state.previous).toBeUndefined()
  expect(Object.hasOwn(state, "previous")).toBe(false)
  expect(view.updatedAt).toBe(START)
})

test("a missing-credentials failure retains its errorKind", async () => {
  const value = config({ codex: { enabled: true } })
  const fetcher = (async () => {
    throw new ProviderError({ kind: "missing_credentials", providerID: "codex", message: "Credentials required" })
  }) as QuotaSnapshotOptions["fetchProvider"]
  const view = await getQuotaSnapshot(options(async () => ({ value, diagnostics: [] }), fetcher))

  expect(view.states[0]).toMatchObject({
    status: "error",
    message: "Credentials required",
    errorKind: "missing_credentials",
  })
})

test("two concurrent calls share one in-flight provider fetch", async () => {
  let resolveFetch: (result: ProviderUsage) => void = () => {}
  const fetcher = (async (id: ProviderID) => {
    calls.push({ id, config: undefined, auth: {}, timeoutMs: 2500 })
    return new Promise<ProviderUsage>((resolve) => {
      resolveFetch = resolve
    })
  }) as QuotaSnapshotOptions["fetchProvider"]
  const value = config({ codex: { enabled: true } })
  const opts = options(async () => ({ value, diagnostics: [] }), fetcher)

  const first = getQuotaSnapshot(opts)
  const second = getQuotaSnapshot(opts)
  await flushMicrotasks()

  expect(calls.map((call) => call.id)).toEqual(["codex"])
  resolveFetch(usage("codex", clock))
  const [firstView, secondView] = await Promise.all([first, second])

  expect(calls.map((call) => call.id)).toEqual(["codex"])
  expect(secondView.states).toEqual(firstView.states)
  expect(secondView.updatedAt).toBe(firstView.updatedAt)
})

test("the view is JSON-safe and omits undefined properties", async () => {
  const value = config({ codex: { enabled: true }, deepseek: { enabled: true } })
  const fetcher = (async (id: ProviderID) => {
    if (id === "codex") {
      throw new ProviderError({ kind: "missing_credentials", providerID: "codex", message: "Credentials required" })
    }
    throw new Error("offline")
  }) as QuotaSnapshotOptions["fetchProvider"]
  const view = await getQuotaSnapshot(options(async () => ({ value, diagnostics: [] }), fetcher))

  const codex = view.states[0] as Extract<(typeof view.states)[number], { status: "error" }>
  const deepseek = view.states[1] as Extract<(typeof view.states)[number], { status: "error" }>
  expect(codex.errorKind).toBe("missing_credentials")
  expect(Object.hasOwn(deepseek, "errorKind")).toBe(false)
  expect(Object.hasOwn(deepseek, "previous")).toBe(false)
  expect(JSON.parse(JSON.stringify(view))).toEqual(view)
})

test("loader failures become diagnostics and never throw out of getQuotaSnapshot", async () => {
  const fetcher = recordingFetcher()
  const view = await getQuotaSnapshot(
    options(async () => {
      throw new Error("config boom")
    }, fetcher, async () => {
      throw new Error("auth boom")
    }),
  )

  expect(view.diagnostics).toEqual(["Quota configuration could not be loaded"])
  expect(view.states).toEqual([])
})

test("auth diagnostics are included and config diagnostics are reloaded each call", async () => {
  const value = config({ codex: { enabled: true } })
  const opts = options(
    async () => ({ value, diagnostics: ["config diagnostic"] }),
    recordingFetcher(),
    async () => ({ auth: {}, diagnostic: "auth diagnostic" }),
  )

  const view = await getQuotaSnapshot(opts)

  expect(view.diagnostics).toEqual(["config diagnostic", "auth diagnostic"])
})

test("updatedAt is null and states are empty before any refresh or when quota is disabled", async () => {
  const empty = await getQuotaSnapshot(
    options(async () => ({ value: config({}), diagnostics: [] }), recordingFetcher()),
  )
  expect(empty.updatedAt).toBeNull()
  expect(empty.states).toEqual([])
  expect(empty.providerDisplays).toEqual({})

  const disabled = await getQuotaSnapshot(
    options(async () => ({ value: config({ codex: { enabled: true } }, { enabled: false }), diagnostics: [] }), recordingFetcher()),
  )
  expect(disabled.updatedAt).toBeNull()
  expect(disabled.states).toEqual([])
  expect(calls).toHaveLength(0)
})

test("a provider removed from config mid-fetch does not throw and is absent from states", async () => {
  let value = config({ codex: { enabled: true } })
  let resolveFetch: (result: ProviderUsage) => void = () => {}
  const fetcher = (async (id: ProviderID) => {
    calls.push({ id, config: undefined, auth: {}, timeoutMs: 2500 })
    return new Promise<ProviderUsage>((resolve) => {
      resolveFetch = resolve
    })
  }) as QuotaSnapshotOptions["fetchProvider"]
  const opts = options(async () => ({ value, diagnostics: [] }), fetcher)

  // Call A starts a fetch we deliberately leave unresolved.
  const inFlightCall = getQuotaSnapshot(opts)
  await flushMicrotasks()
  expect(calls.map((call) => call.id)).toEqual(["codex"])

  // A concurrent call sees the new config and evicts the provider's cache entry.
  value = config({})
  const concurrentView = await getQuotaSnapshot(opts)
  expect(concurrentView.states).toEqual([])

  resolveFetch(usage("codex", clock))
  const view = await inFlightCall
  expect(view.states).toEqual([])
  expect(view.states.map((state) => state.id)).not.toContain("codex")
})

test("configured providers with no registered adapter are skipped, not fabricated", async () => {
  // Use a stable fake id so this test keeps working as later tasks fill the registry.
  const unregistered = "future-provider" as ProviderID
  const value = config({ [unregistered]: { enabled: true } })
  const view = await getQuotaSnapshot({
    now: () => clock,
    loadConfig: async () => ({ value, diagnostics: [] }),
    loadAuth: async () => ({ auth: {} }),
    // No injected fetcher: the default registry fetcher has no entry for this id.
  })

  expect(view.states).toEqual([])
  expect(view.providerDisplays).toEqual({})
  expect(calls).toHaveLength(0)
})
