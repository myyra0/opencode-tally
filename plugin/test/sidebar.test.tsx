/* @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"

import { SidebarView, type SidebarViewProps } from "../src/sidebar/Sidebar.js"
import { DEFAULT_SIDEBAR_CONFIG } from "../src/lib/config.js"
import { formatTimestamp } from "../src/lib/quota/format.js"
import { balanceQuota, percentageQuota } from "../src/lib/quota/usage.js"
import type { ProviderDisplayConfig, ProviderState, QuotaView } from "../src/lib/quota/types.js"
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
  cacheRead: 12_000,
  cacheWrite: 2_000,
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
    rows: [{ label: "system", tokens: 5_600 }],
    total: 5_600,
  },
  tools: [],
  topContributors: [],
  steps: 1,
  lastStep: usage,
  recorded: usage,
  costBasis: "recorded",
  cost: 0.07,
  cache: { hitRate: 92.6, savings: 0.45, savingsPercent: 50 },
  subagents: {
    steps: 1,
    tokens: 1,
    cost: 0,
    sessions: [
      { title: "secret", agent: "secret-agent", tokens: 1, cost: 0, costBasis: "recorded", steps: 1 },
    ],
  },
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

function display(overrides: Partial<ProviderDisplayConfig> = {}): ProviderDisplayConfig {
  return { showSidebarBar: true, sidebarWindow: "all", showFooterBar: true, footerWindow: "auto", ...overrides }
}

const multiWindowQuota: QuotaView = {
  states: [
    {
      id: "codex",
      label: "Codex",
      status: "ready",
      stale: false,
      data: {
        id: "codex",
        label: "Codex",
        capturedAt: NOW,
        windows: [
          { kind: "rolling", label: "5h", quota: percentageQuota(42), resetsAt: NOW + 3600_000 },
          { kind: "weekly", label: "week", quota: percentageQuota(65), resetsAt: NOW + 7 * 24 * 3600_000 },
          { kind: "monthly", label: "month", quota: percentageQuota(80), resetsAt: NOW + 30 * 24 * 3600_000 },
        ],
      },
    },
  ],
  providerDisplays: {},
  diagnostics: [],
  updatedAt: NOW,
  showErrors: true,
}

const kindWindowQuota: QuotaView = {
  ...multiWindowQuota,
  states: [
    {
      ...multiWindowQuota.states[0],
      data: {
        id: "codex",
        label: "Codex",
        capturedAt: NOW,
        windows: [
          { kind: "daily", label: "day", quota: percentageQuota(11), resetsAt: NOW + 3600_000 },
          { kind: "credits", label: "cred", quota: percentageQuota(22), resetsAt: NOW + 3600_000 },
          { kind: "other", label: "othr", quota: percentageQuota(33), resetsAt: NOW + 3600_000 },
        ],
      },
    } as ProviderState,
  ],
}

// A 5h label whose semantic kind is not "rolling", so a rolling filter must match on the label.
const fiveHourOtherQuota: QuotaView = {
  ...multiWindowQuota,
  states: [
    {
      ...multiWindowQuota.states[0],
      data: {
        id: "codex",
        label: "Codex",
        capturedAt: NOW,
        windows: [{ kind: "other", label: "5h", quota: percentageQuota(42), resetsAt: NOW + 3600_000 }],
      },
    } as ProviderState,
  ],
}

async function render(props: Partial<SidebarViewProps> = {}, width = 36): Promise<string> {
  const setup = await testRender(
    () => (
      <SidebarView
        report={report}
        quota={quota}
        theme={theme}
        config={DEFAULT_SIDEBAR_CONFIG}
        width={width}
        {...props}
      />
    ),
    { width, height: 60 }
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

test("renders the default sections in order with a quota row and a local percentage row", async () => {
  const frame = await render()
  const order = ["Tally", "Quota", "Context", "Recorded usage", "Context window"]

  let previous = -1
  for (const label of order) {
    const index = frame.indexOf(label)
    expect(index).toBeGreaterThan(previous)
    previous = index
  }

  const quotaRow = lineWith(frame, "5h", "42%")
  expect(quotaRow).toContain("[")
  expect(quotaRow).toContain("]")

  const localRow = lineWith(frame, "input", "475.9k")
  expect(localRow.indexOf("%")).toBeLessThan(localRow.indexOf("475.9k"))
})

test("renders no subagent line", async () => {
  const frame = await render()
  expect(frame).not.toContain("Subagents")
  expect(frame).not.toContain("secret-agent")
})

test("renders a block for each provider", async () => {
  const second: ProviderState = {
    id: "codex",
    label: "Codex",
    status: "ready",
    stale: false,
    data: {
      id: "codex",
      label: "Codex",
      capturedAt: NOW,
      windows: [{ kind: "rolling", label: "5h", quota: percentageQuota(7), resetsAt: NOW + 3600_000 }],
    },
  }
  const frame = await render({ quota: { ...quota, states: [...quota.states, second] } })

  expect(frame).toContain("OpenCode GO")
  expect(frame).toContain("Codex")
})

test("omits the context percentage and bar when the model limit is unknown", async () => {
  const lines = (await render({ report: { ...report, contextLimit: undefined } })).split("\n")
  const start = lines.findIndex((line) => line.includes("Context"))
  const end = lines.findIndex((line, index) => index > start && line.includes("Recorded usage"))
  const section = lines.slice(start + 1, end).join("\n")

  expect(section).toContain("5.6k tokens")
  expect(section).not.toContain("%")
  expect(section).not.toContain("█")
  expect(section).not.toContain("░")
  expect(section.toLowerCase()).not.toContain("nanm")
})

test("collapses warnings into a badge", async () => {
  const frame = await render({ report: { ...report, warnings: ["context near limit"] } })
  expect(frame).toContain("! 1 warnings")
})

test("renders config diagnostics as short lines", async () => {
  const frame = await render({
    configDiagnostics: ["Invalid sidebar.refreshSeconds: 5", "Unknown sidebar section: nope"],
  })

  expect(frame).toContain("Invalid sidebar.refreshSeconds: 5")
  expect(frame).toContain("Unknown sidebar section: nope")
})

test("honors the showBars and showPercentages config flags", async () => {
  const frame = await render({
    config: { ...DEFAULT_SIDEBAR_CONFIG, showBars: false, showPercentages: false },
  })

  expect(frame).not.toContain("█")
  expect(frame).not.toContain("░")
  expect(frame).not.toContain("42%")
})

test("honors the showWarnings and showUpdated config flags", async () => {
  const frame = await render({
    report: { ...report, warnings: ["context near limit"] },
    config: { ...DEFAULT_SIDEBAR_CONFIG, showWarnings: false, showUpdated: false },
  })

  expect(frame).not.toContain("! 1 warnings")
  expect(frame).not.toContain("Updated")
})

test("renders at a narrow width without wrapping or errors", async () => {
  const frame = await render({}, 28)
  expect(frame).toContain("Tally")
  expect(frame).not.toContain("undefined")
  expect(frame).not.toContain("NaN")
})

test("hides a provider's bar but keeps its text when showSidebarBar is false", async () => {
  const frame = await render({
    quota: { ...quota, providerDisplays: { "opencode-go": display({ showSidebarBar: false }) } },
  })
  const row = lineWith(frame, "5h", "42%")

  expect(row).not.toContain("[")
  expect(row).not.toContain("█")
  expect(row).not.toContain("░")
})

test("global showBars false still suppresses the bar when the provider sets showSidebarBar true", async () => {
  const frame = await render({
    config: { ...DEFAULT_SIDEBAR_CONFIG, showBars: false },
    quota: { ...quota, providerDisplays: { "opencode-go": display({ showSidebarBar: true }) } },
  })
  const row = lineWith(frame, "5h", "42%")

  expect(row).toContain("5h")
  expect(row).toContain("42%")
  expect(row).toContain("4h")
  expect(row).not.toContain("[")
  expect(row).not.toContain("█")
  expect(row).not.toContain("░")
})

test("matches daily, credits and other sidebarWindow values by window kind", async () => {
  for (const [selected, label, others] of [
    ["daily", "day", ["cred", "othr"]],
    ["credits", "cred", ["day", "othr"]],
    ["other", "othr", ["day", "cred"]],
  ] as const) {
    const frame = await render({
      quota: { ...kindWindowQuota, providerDisplays: { codex: display({ sidebarWindow: selected }) } },
    })

    expect(frame).toContain(label)
    for (const other of others) expect(frame).not.toContain(other)
  }
})

test("filters sidebar windows to the provider's sidebarWindow", async () => {
  const frame = await render({
    quota: { ...multiWindowQuota, providerDisplays: { codex: display({ sidebarWindow: "weekly" }) } },
  })

  expect(frame).toContain("Codex")
  expect(frame).toContain("week")
  expect(frame).not.toContain("month")
  expect(frame).not.toContain("5h")
})

test("omits a provider whose windows are all filtered out", async () => {
  const frame = await render({
    quota: { ...quota, providerDisplays: { "opencode-go": display({ sidebarWindow: "weekly" }) } },
  })

  expect(frame).not.toContain("OpenCode GO")
})

test("matches a 5h-labeled window for sidebarWindow rolling", async () => {
  const frame = await render({
    quota: { ...fiveHourOtherQuota, providerDisplays: { codex: display({ sidebarWindow: "rolling" }) } },
  })

  expect(lineWith(frame, "5h", "42%")).toBeDefined()
  expect(frame).not.toContain("week")
  expect(frame).not.toContain("month")
})

test("uses refreshedAt for the Updated line and falls back to the report time", async () => {
  const refreshedAt = NOW + 2 * 3600_000
  const refreshed = await render({ refreshedAt })

  expect(refreshed).toContain(`Updated ${formatTimestamp(refreshedAt)}`)
  expect(refreshed).not.toContain(`Updated ${formatTimestamp(NOW)}`)
  expect(await render()).toContain(`Updated ${formatTimestamp(NOW)}`)
})
