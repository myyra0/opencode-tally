/* @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"

import { ReportPanelView, type ReportPanelViewProps } from "../src/panel/ReportPanel.js"
import { balanceQuota, percentageQuota } from "../src/lib/quota/usage.js"
import type { ProviderState, QuotaView } from "../src/lib/quota/types.js"
import type { ReportView } from "../src/lib/rpc.js"

const NOW = 1_700_000_000_000
const color = RGBA.fromValues(1, 2, 3, 255)

const theme = {
  categorical: [{ 200: color }],
  text: {
    base: color,
    muted: color,
    faint: color,
    feedback: {
      error: { base: color },
      success: { base: color },
      warning: { base: color },
    },
  },
}

const usage = {
  input: 475_904,
  cacheRead: 0,
  cacheWrite: 0,
  output: 100,
  reasoning: 0,
  cost: 0.07,
}

const report: ReportView = {
  sessionID: "session-1",
  generatedAt: NOW,
  model: "test/model",
  tokenizer: "approx",
  warnings: [],
  contextLimit: 200_000,
  content: {
    rows: [
      { label: "system", tokens: 475_904 },
      { label: "Empty source", tokens: 0 },
    ],
    total: 475_904,
  },
  tools: [{ name: "read", tokens: 100, calls: 2 }],
  topContributors: [],
  steps: 1,
  lastStep: usage,
  recorded: usage,
  costBasis: "recorded",
  cost: 0.07,
  total: { cost: 0.07, costBasis: "recorded", tokens: 476_004, steps: 1 },
}

const quota: QuotaView = {
  states: [
    {
      id: "opencode-go",
      label: "OpenCode GO",
      status: "ready",
      stale: false,
      data: {
        id: "opencode-go",
        label: "OpenCode GO",
        capturedAt: NOW,
        windows: [
          {
            kind: "rolling",
            label: "5h",
            quota: percentageQuota(42),
            resetsAt: NOW + 4 * 3600_000 + 46 * 60_000,
          },
          {
            kind: "credits",
            label: "USD balance",
            quota: balanceQuota(12.5, "USD"),
            resetsAt: null,
          },
        ],
      },
    },
  ],
  providerDisplays: {},
  diagnostics: [],
  updatedAt: NOW,
  showErrors: true,
}

async function render(props: Partial<ReportPanelViewProps> = {}): Promise<string> {
  const setup = await testRender(
    () => <ReportPanelView report={report} quota={quota} theme={theme} width={120} {...props} />,
    { width: 120, height: 40 }
  )
  try {
    await setup.flush()
    return setup.captureCharFrame()
  } finally {
    setup.renderer.destroy()
  }
}

function lineWith(frame: string, ...needles: string[]): string {
  const line = frame.split("\n").find((candidate) => needles.every((needle) => candidate.includes(needle)))
  expect(line).toBeDefined()
  return line!
}

test("renders quota first and keeps the canonical section order", async () => {
  const frame = await render()
  const order = ["Quota", "OpenCode GO", "Context", "Recorded usage", "Context window", "Last request"]

  let previous = -1
  for (const label of order) {
    const index = frame.indexOf(label)
    expect(index).toBeGreaterThan(previous)
    previous = index
  }
})

test("renders a quota row as bar, percentage, then value", async () => {
  const line = lineWith(await render(), "5h", "42%")

  expect(line.indexOf("[")).toBeLessThan(line.indexOf("42%"))
  expect(line.indexOf("42%")).toBeLessThan(line.indexOf("4h 46m"))
})

test("renders a balance quota as a line without a bar", async () => {
  const line = lineWith(await render(), "USD balance", "$12.50 remaining")

  expect(line).not.toContain("[")
})

test("omits zero-valued local rows", async () => {
  expect(await render()).not.toContain("Empty source")
})

test("marks a ready-but-stale quota provider", async () => {
  const frame = await render({
    quota: { ...quota, states: [{ ...quota.states[0], stale: true } as ProviderState] },
  })

  expect(lineWith(frame, "OpenCode GO")).toContain("(stale)")
})

test("truncates long quota error text", async () => {
  const message = "x".repeat(160)
  const frame = await render({
    quota: {
      ...quota,
      states: [{ id: "opencode-go", label: "OpenCode GO", status: "error", message, errorKind: "transport" }],
    },
  })
  const line = lineWith(frame, "!")

  expect(line).toContain(`${"x".repeat(99)}…`)
  expect(line).not.toContain("x".repeat(100))
})

test("omits the context percentage and bar when the model limit is unknown", async () => {
  const lines = (await render({ report: { ...report, contextLimit: undefined } })).split("\n")
  const start = lines.findIndex((line) => line.includes("Context"))
  const end = lines.findIndex((line, index) => index > start && line.includes("Recorded usage"))
  const section = lines.slice(start + 1, end).join("\n")

  expect(section).toContain("475,904 tokens")
  expect(section).not.toContain("%")
  expect(section).not.toContain("█")
  expect(section).not.toContain("░")
})

test("shows the loading and error states without a report", async () => {
  expect(await render({ report: undefined, loading: true })).toContain("Analyzing session")
  expect(await render({ report: undefined, error: new Error("rpc down") })).toContain("rpc down")
  expect(await render({ quota: undefined, quotaError: new Error("quota down") })).toContain("quota down")
})

test("ignores sidebar-only provider display settings", async () => {
  const frame = await render({
    quota: {
      ...quota,
      providerDisplays: {
        "opencode-go": {
          showSidebarBar: false,
          sidebarWindow: "weekly",
          showFooterBar: true,
          footerWindow: "auto",
        },
      },
    },
  })

  expect(lineWith(frame, "5h", "42%")).toContain("[")
  expect(frame).toContain("USD balance")
})
