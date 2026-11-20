import type { Plugin } from "@opencode/plugin/tui"
import { expect, test } from "bun:test"

import { loadSidebarData } from "../../src/sidebar/Sidebar.js"
import { DEFAULT_SIDEBAR_CONFIG } from "../../src/lib/config.js"
import type { QuotaView, SidebarConfig } from "../../src/lib/quota/types.js"
import type { ReportView } from "../../src/lib/rpc.js"

const report: ReportView = {
  sessionID: "s1",
  generatedAt: 1_700_000_000_000,
  model: "test/model",
  tokenizer: "approx",
  warnings: [],
  content: { rows: [], total: 0 },
  tools: [],
  topContributors: [],
  steps: 0,
  lastStep: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cost: 0 },
  recorded: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cost: 0 },
  costBasis: "recorded",
  cost: 0,
  total: { cost: 0, costBasis: "recorded", tokens: 0, steps: 0 },
}

const quota: QuotaView = {
  states: [],
  providerDisplays: {},
  diagnostics: [],
  updatedAt: 1_700_000_000_000,
  showErrors: true,
}

function makeContext(reportResult: () => Promise<unknown> = async () => report, quotaResult: () => Promise<unknown> = async () => quota) {
  const calls = { report: 0, quota: 0 }
  const context = {
    data: { session: { get: () => undefined, status: () => "idle" } },
    client: {
      rpc: () => ({
        report: async (...args: unknown[]) => {
          calls.report++
          return reportResult(...args)
        },
        quota: async () => {
          calls.quota++
          return quotaResult()
        },
      }),
    },
  } as unknown as Plugin.Context
  return { context, calls }
}

function load(context: Plugin.Context, config: SidebarConfig) {
  return loadSidebarData({ context, sessionID: "s1", loadConfig: async () => ({ value: config, diagnostics: [] }) })
}

test("loads config and both RPCs once per refresh cycle", async () => {
  const { context, calls } = makeContext()
  let configCalls = 0
  const data = await loadSidebarData({
    context,
    sessionID: "s1",
    loadConfig: async () => {
      configCalls++
      return { value: DEFAULT_SIDEBAR_CONFIG, diagnostics: ["Invalid sidebar.refreshSeconds: 5"] }
    },
  })

  expect(configCalls).toBe(1)
  expect(calls.report).toBe(1)
  expect(calls.quota).toBe(1)
  expect(data.config).toBe(DEFAULT_SIDEBAR_CONFIG)
  expect(data.configDiagnostics).toEqual(["Invalid sidebar.refreshSeconds: 5"])
  expect(data.report).toBe(report)
  expect(data.quota).toBe(quota)
  expect(data.configError).toBeUndefined()
  expect(data.reportError).toBeUndefined()
  expect(data.quotaError).toBeUndefined()
})

test("does not call the RPCs when the sidebar is disabled", async () => {
  const { context, calls } = makeContext()
  const data = await load(context, { ...DEFAULT_SIDEBAR_CONFIG, enabled: false })

  expect(calls.report).toBe(0)
  expect(calls.quota).toBe(0)
  expect(data.config.enabled).toBe(false)
  expect(data.report).toBeUndefined()
  expect(data.quota).toBeUndefined()
})

test("surfaces a config error but still loads using defaults", async () => {
  const { context, calls } = makeContext()
  const data = await loadSidebarData({
    context,
    sessionID: "s1",
    loadConfig: async () => {
      throw new Error("bad config")
    },
  })

  expect(data.configError?.message).toBe("bad config")
  expect(data.configDiagnostics).toEqual([])
  expect(data.config).toBe(DEFAULT_SIDEBAR_CONFIG)
  expect(calls.report).toBe(1)
  expect(calls.quota).toBe(1)
  expect(data.report).toBe(report)
  expect(data.quota).toBe(quota)
})

test("captures report and quota failures independently", async () => {
  const failing = makeContext(async () => {
    throw { type: "empty_session", message: "nothing to analyze" }
  })
  const data = await load(failing.context, DEFAULT_SIDEBAR_CONFIG)
  expect(data.reportError?.message).toBe("nothing to analyze")
  expect(data.quota).toBe(quota)

  const failingQuota = makeContext(undefined, async () => {
    throw new Error("quota down")
  })
  const other = await load(failingQuota.context, DEFAULT_SIDEBAR_CONFIG)
  expect(other.quotaError?.message).toBe("quota down")
  expect(other.report).toBe(report)
})
