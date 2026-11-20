import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CostCalculator } from "../src/lib/cost.js"
import { OutputFormatter } from "../src/lib/formatter.js"
import { formatRate, formatUsd } from "../src/lib/formatter-helpers.js"
import { formatQuotaSection } from "../src/lib/formatter-insight-sections.js"
import type { ProviderUsage, QuotaView } from "../src/lib/quota/types.js"
import { countQuota, percentageQuota } from "../src/lib/quota/usage.js"
import { buildFormatterFixtureAnalysis, buildFormatterFixtureReport } from "./formatter.fixture.js"

const testDir = path.dirname(fileURLToPath(import.meta.url))

test("formats the full token report without changing layout", async () => {
  const expected = await fs.readFile(path.join(testDir, "fixtures", "formatter-full-report.txt"), "utf8")

  expect(buildFormatterFixtureReport()).toBe(expected)
})

test("formats optional detailed subagent breakdowns when enabled", () => {
  const formatter = new OutputFormatter(
    new CostCalculator({
      "anthropic/claude-sonnet-4-20250514": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
      "google/gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.075 },
      default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
    })
  )

  formatter.setConfig({
    enableContextBreakdown: true,
    enableToolSchemaEstimation: true,
    enableCacheEfficiency: true,
    enableSubagentAnalysis: true,
    enableDetailedSubagentCostBreakdown: true,
    enableSkillAnalysis: true,
  })

  const report = formatter.format(buildFormatterFixtureAnalysis())

  expect(report).toContain("Tokens: fresh 500 | cache read 10,000 | cache write 0 | output 200 | reasoning 25")
  expect(report).toContain(
    "Estimated API-rate split: fresh $0.0015 | cache read $0.0030 | cache write $0.0000 | output+reasoning $0.000375 (estimated total $0.004875 | OpenCode-recorded total $0.0042)"
  )
  expect(report).toContain("Displayed subagent costs use OpenCode-recorded child cost")
  expect(report).toContain("Subagent Total:")
})

test("formats recorded subagent costs even when the main session recorded zero cost", () => {
  const formatter = new OutputFormatter(
    new CostCalculator({
      "anthropic/claude-sonnet-4-20250514": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
      "google/gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.075 },
      default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
    })
  )

  formatter.setConfig({
    enableContextBreakdown: true,
    enableToolSchemaEstimation: true,
    enableCacheEfficiency: true,
    enableSubagentAnalysis: true,
    enableDetailedSubagentCostBreakdown: true,
    enableSkillAnalysis: true,
  })

  const report = formatter.format({
    ...buildFormatterFixtureAnalysis(),
    sessionCost: 0,
  })

  expect(report).toContain("reviewer                     $0.0042")
  expect(report).toContain("OpenCode-recorded total $0.0042")
  expect(report).toContain("Displayed subagent costs use OpenCode-recorded child cost")
  expect(report).not.toContain("the displayed subagent cost is the estimate")
})

test("preserves meaningful precision for small USD amounts", () => {
  expect(formatUsd(0)).toBe("0.0000")
  expect(formatUsd(0.0456)).toBe("0.0456")
  expect(formatUsd(0.00001234)).toBe("0.00001234")
})

test("preserves meaningful precision for per-million rates", () => {
  expect(formatRate(3)).toBe("3.00")
  expect(formatRate(0.075)).toBe("0.075")
  expect(formatRate(0.00875)).toBe("0.00875")
})

test("formats zero-recorded-cost reports without assuming a subscription", () => {
  const formatter = new OutputFormatter(
    new CostCalculator({
      "anthropic/claude-sonnet-4-20250514": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
      "google/gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.075 },
      default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
    })
  )

  formatter.setConfig({
    enableContextBreakdown: true,
    enableToolSchemaEstimation: true,
    enableCacheEfficiency: true,
    enableSubagentAnalysis: true,
    enableDetailedSubagentCostBreakdown: false,
    enableSkillAnalysis: true,
  })

  const report = formatter.format({
    ...buildFormatterFixtureAnalysis(),
    sessionCost: 0,
  })

  expect(report).toContain("ESTIMATED API-RATE COST (OpenCode recorded $0)")
  expect(report).toContain("can mean subscription, free/local usage, or zero/missing pricing metadata")
  expect(report).not.toContain("You appear to be on a subscription plan")
})

const QUOTA_NOW = 1_700_000_000_000
const HOUR = 60 * 60 * 1000

function readyUsage(id: "opencode-go" | "codex", windows: ProviderUsage["windows"]): ProviderUsage {
  return { id, label: id === "codex" ? "Codex" : "OpenCode GO", capturedAt: QUOTA_NOW, windows }
}

function quotaFixture(overrides: Partial<QuotaView> = {}): QuotaView {
  return {
    states: [
      {
        id: "opencode-go",
        label: "OpenCode GO",
        status: "ready",
        stale: false,
        data: readyUsage("opencode-go", [
          {
            kind: "rolling",
            label: "Rolling",
            quota: percentageQuota(42),
            resetsAt: QUOTA_NOW + 5 * HOUR,
          },
        ]),
      },
      {
        id: "codex",
        label: "Codex",
        status: "ready",
        stale: false,
        data: readyUsage("codex", [
          {
            kind: "daily",
            label: "daily",
            quota: countQuota(3, 10, 30, "requests"),
            resetsAt: QUOTA_NOW + 24 * HOUR,
          },
        ]),
      },
    ],
    providerDisplays: {},
    diagnostics: [],
    updatedAt: QUOTA_NOW,
    showErrors: true,
    ...overrides,
  }
}

function reportWithQuota(quota?: QuotaView): string {
  const formatter = new OutputFormatter(new CostCalculator({ default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 } }))
  return formatter.format(buildFormatterFixtureAnalysis(), quota)
}

test("renders a QUOTAS section between warnings and the token breakdown", () => {
  const report = reportWithQuota(quotaFixture())

  expect(report).toContain("QUOTAS")
  expect(report).toContain("OpenCode GO")
  expect(report).toContain("Codex")
  expect(report).toContain("Rolling")
  expect(report).toContain("daily")
  expect(report.indexOf("WARNINGS")).toBeLessThan(report.indexOf("QUOTAS"))
  expect(report.indexOf("QUOTAS")).toBeLessThan(report.indexOf("TOKEN BREAKDOWN BY CATEGORY"))
})

test("renders a 20-cell bar before the percentage and the raw value", () => {
  const report = reportWithQuota(quotaFixture())
  const bar = "[████████░░░░░░░░░░░░]"
  const value = "3 requests / 10 requests used"

  const codexLine = report.split("\n").find((line) => line.includes("daily:"))!
  const codexBar = "[██████░░░░░░░░░░░░░░]"

  expect(report).toContain(bar)
  expect(codexLine).toContain(codexBar)
  expect(codexLine).toContain("30%")
  expect(codexLine).toContain(value)
  expect(codexLine.indexOf(codexBar)).toBeLessThan(codexLine.indexOf("30%"))
  expect(codexLine.indexOf("30%")).toBeLessThan(codexLine.indexOf(value))
})

test("renders unitless count quotas with their raw values", () => {
  const view = quotaFixture({
    states: [
      {
        id: "qwen",
        label: "Qwen",
        status: "ready",
        stale: false,
        data: {
          id: "qwen",
          label: "Qwen",
          capturedAt: QUOTA_NOW,
          windows: [{ kind: "other", label: "messages", quota: countQuota(3, 10, 30), resetsAt: null }],
        },
      },
    ],
  })
  const lines = formatQuotaSection(view, QUOTA_NOW).join("\n")

  expect(lines).toContain("30%")
  expect(lines).toContain("3 / 10 used")
})

test("renders reset countdowns against the supplied clock", () => {
  const lines = formatQuotaSection(quotaFixture(), QUOTA_NOW)

  expect(lines.join("\n")).toContain("· 5h")
  expect(lines.join("\n")).toContain("· 1d")
})

test("renders balance quotas without a bar", () => {
  const view = quotaFixture({
    states: [
      {
        id: "codex",
        label: "Codex",
        status: "ready",
        stale: false,
        data: readyUsage("codex", [
          {
            kind: "credits",
            label: "Credits",
            quota: { _tag: "Balance", remaining: 12.5, unit: "USD" },
            resetsAt: null,
          },
        ]),
      },
    ],
  })
  const lines = formatQuotaSection(view, QUOTA_NOW).join("\n")

  expect(lines).toContain("Credits  $12.50 remaining")
  expect(lines).not.toContain("█")
  expect(lines).not.toContain("░")
})

test("marks stale and cached providers and shortens error messages", () => {
  const view = quotaFixture({
    states: [
      {
        id: "opencode-go",
        label: "OpenCode GO",
        status: "ready",
        stale: true,
        data: readyUsage("opencode-go", [
          { kind: "rolling", label: "Rolling", quota: percentageQuota(42), resetsAt: null },
        ]),
      },
      {
        id: "codex",
        label: "Codex",
        status: "error",
        message: "Upstream is unreachable: connect ECONNREFUSED 127.0.0.1:8080 with a very long trailing detail that must be trimmed",
        previous: readyUsage("codex", [
          {
            kind: "daily",
            label: "daily",
            quota: percentageQuota(30),
            resetsAt: null,
          },
        ]),
      },
    ],
  })
  const lines = formatQuotaSection(view, QUOTA_NOW).join("\n")

  expect(lines).toContain("stale")
  expect(lines).toContain("cached")
  expect(lines).toContain("Error: Upstream is unreachable")
  expect(lines).not.toContain("trailing detail that must be trimmed")
  expect(lines.split("\n").find((line) => line.includes("Error:"))!.endsWith("…")).toBe(true)
})

test("hides missing-credential providers when showErrors is false", () => {
  const view = quotaFixture({
    states: [{ id: "codex", label: "Codex", status: "error", message: "Credentials required", errorKind: "missing_credentials" }],
    showErrors: false,
  })

  expect(reportWithQuota(view)).not.toContain("Codex")
  expect(reportWithQuota({ ...view, showErrors: true })).toContain("Codex")
})

test("omits the QUOTAS section when the quota view is empty", () => {
  const empty = quotaFixture({ states: [], diagnostics: [], updatedAt: null })

  expect(reportWithQuota(empty)).not.toContain("QUOTAS")
  expect(reportWithQuota()).not.toContain("QUOTAS")
})
