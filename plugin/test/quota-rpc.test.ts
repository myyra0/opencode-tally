import { beforeEach, expect, test } from "bun:test"

import { DEFAULT_QUOTA_CONFIG } from "../src/lib/config.js"
import { createQuotaHandler } from "../src/lib/quota/rpc.js"
import { resetQuotaSnapshotCache } from "../src/lib/quota/snapshot.js"
import type { ProviderUsage, QuotaConfig } from "../src/lib/quota/types.js"
import { TallyRpc } from "../src/lib/rpc.js"
import plugin from "../src/index.ts"

const NOW = 1_700_000_000_000

beforeEach(() => {
  resetQuotaSnapshotCache()
})

async function loadPlugin(): Promise<{ rpc: any }> {
  const registered: { rpc?: any } = {}
  const registration = { dispose: async () => {} }
  const ctx = {
    options: {},
    location: { directory: "/plugin-location" },
    session: {
      async hook() {
        return registration
      },
      async get() {
        throw new Error("unused")
      },
      async context() {
        return []
      },
      async list() {
        return { data: [], cursor: {} }
      },
      async prompt() {},
    },
    model: { async list() { return { data: [] } } },
    agent: { async list() { return [] } },
    skill: { async list() { return [] } },
    tool: { async transform() { return registration } },
    command: { async transform() { return registration } },
    rpc: {
      async register(definition: any, handlers: any) {
        registered.rpc = { definition, handlers }
        return registration
      },
    },
  }
  await plugin.setup(ctx as any)
  return registered as { rpc: any }
}

function config(overrides: Partial<QuotaConfig> = {}): QuotaConfig {
  return { ...DEFAULT_QUOTA_CONFIG, providers: { "opencode-go": { enabled: true } }, ...overrides }
}

function usage(): ProviderUsage {
  return {
    id: "opencode-go",
    label: "OpenCode GO",
    capturedAt: NOW,
    windows: [
      {
        kind: "rolling",
        label: "Rolling",
        quota: { _tag: "Percentage", remainingPercent: 58, usedPercent: 42 },
        resetsAt: null,
      },
    ],
  }
}

test("the quota method is declared with an empty input and an object output", async () => {
  expect(TallyRpc.methods.quota.input).toEqual({ type: "object", properties: {}, additionalProperties: false })
  expect(TallyRpc.methods.quota.output).toEqual({ type: "object" })

  const registered = await loadPlugin()
  expect(typeof registered.rpc.handlers.quota).toBe("function")
})

test("the quota handler returns a JSON-safe view from injected config and provider", async () => {
  let fetched = 0
  const handler = createQuotaHandler({
    now: () => NOW,
    loadConfig: async () => ({ value: config(), diagnostics: [] }),
    loadAuth: async () => ({ auth: {} }),
    fetchProvider: async () => {
      fetched += 1
      return usage()
    },
  })

  const view = await handler()

  expect(fetched).toBe(1)
  expect(Object.keys(view).sort()).toEqual(["diagnostics", "providerDisplays", "showErrors", "states", "updatedAt"])
  expect(view.states).toHaveLength(1)
  expect(view.states[0]).toMatchObject({ id: "opencode-go", label: "OpenCode GO", status: "ready" })
  expect(view.providerDisplays["opencode-go"]).toEqual({
    showSidebarBar: true,
    sidebarWindow: "all",
    showFooterBar: true,
    footerWindow: "auto",
  })
  expect(view.updatedAt).toBe(NOW)
  expect(view.showErrors).toBe(true)
  expect(view.diagnostics).toEqual([])
  expect(JSON.parse(JSON.stringify(view))).toEqual(view)
})

test("the quota handler never throws and reports loader failures as diagnostics", async () => {
  const handler = createQuotaHandler({
    now: () => NOW,
    loadConfig: async () => {
      throw new Error("config boom")
    },
  })

  const view = await handler()

  expect(view.diagnostics).toEqual(["Quota configuration could not be loaded"])
  expect(view.states).toEqual([])
})

test("the plugin's registered quota method returns a JSON-safe view", async () => {
  const registered = await loadPlugin()
  const view = await registered.rpc.handlers.quota(
    {},
    { signal: new AbortController().signal, error: (type: string, message: string, data: unknown) => ({ type, message, data }) }
  )

  expect(Array.isArray(view.states)).toBe(true)
  expect(Array.isArray(view.diagnostics)).toBe(true)
  expect(view.providerDisplays).toEqual({})
  expect(JSON.parse(JSON.stringify(view))).toEqual(view)
})
