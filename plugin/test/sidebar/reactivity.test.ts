import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"

import { contextDerived, contextValueText, recordedDerived } from "../../src/sidebar/Sidebar.js"
import type { ReportView } from "../../src/lib/rpc.js"

function reportWith(input: number, output: number, limit: number | undefined): ReportView {
  return {
    sessionID: "s1",
    generatedAt: 1_700_000_000_000,
    model: "test/model",
    tokenizer: "approx",
    warnings: [],
    contextLimit: limit,
    content: { rows: [{ label: "system", tokens: input }], total: input },
    tools: [],
    topContributors: [],
    steps: 1,
    lastStep: { input, cacheRead: 0, cacheWrite: 0, output, reasoning: 0, cost: 0 },
    recorded: { input, cacheRead: 0, cacheWrite: 0, output, reasoning: 0, cost: 0 },
    costBasis: "recorded",
    cost: 0,
    total: { cost: 0, costBasis: "recorded", tokens: input + output, steps: 1 },
  }
}

test("recorded and context derivations follow report replacements", () => {
  createRoot((dispose) => {
    const first = reportWith(100, 200, 1_000)
    const second = reportWith(300, 400, 2_000)
    const [report, setReport] = createSignal<ReportView | undefined>(first)
    const recorded = recordedDerived(report)
    const context = contextDerived(report)

    expect(recorded.total()).toBe(300)
    expect(recorded.rows()[0].tokens).toBe(100)
    expect(context.total()).toBe(100)
    expect(context.limit()).toBe(1_000)

    setReport(second)
    expect(recorded.total()).toBe(700)
    expect(recorded.rows()[0].tokens).toBe(300)
    expect(context.total()).toBe(300)
    expect(context.limit()).toBe(2_000)

    setReport(undefined)
    expect(recorded.total()).toBe(0)
    expect(recorded.rows()).toEqual([])
    expect(context.total()).toBe(0)
    expect(context.limit()).toBeUndefined()

    dispose()
  })
})

test("context falls back to total-only text when the limit disappears", () => {
  createRoot((dispose) => {
    const [report, setReport] = createSignal<ReportView | undefined>(reportWith(100, 200, 1_000))
    const context = contextDerived(report)

    expect(context.limit()).toBe(1_000)
    expect(contextValueText(context.total(), context.limit())).toBe("100 / 1k")

    setReport(reportWith(300, 400, undefined))
    expect(context.limit()).toBeUndefined()
    const value = contextValueText(context.total(), context.limit())
    expect(value).toBe("300 tokens")
    expect(value).not.toContain("NaN")

    dispose()
  })
})
