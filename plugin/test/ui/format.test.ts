import { expect, test } from "bun:test"

import { barCells, formatDuration, formatPercent, formatTokens, formatUsd } from "../../src/ui/format.js"

test("formatTokens uses compact K/M in the sidebar and exact integers in the panel", () => {
  expect(formatTokens(475_904, true)).toBe("475.9k")
  expect(formatTokens(475_904, false)).toBe("475,904")
  expect(formatTokens(999, true)).toBe("999")
  expect(formatTokens(1_000_000, true)).toBe("1m")
})

test("formatPercent renders one decimal and nothing when the whole is unknown", () => {
  expect(formatPercent(475_904, 514_118)).toBe("92.6%")
  expect(formatPercent(1, 0)).toBe("")
})

test("formatUsd renders a currency-prefixed value with two decimals", () => {
  expect(formatUsd(0.07)).toBe("$0.07")
  expect(formatUsd(12.5)).toBe("$12.50")
})

test("formatDuration renders compact reset durations", () => {
  expect(formatDuration(4 * 3600_000 + 46 * 60_000, 0)).toBe("4h 46m")
  expect(formatDuration(0, 0)).toBe("now")
})

test("barCells fills 0, half, and all cells for 0/50/100 percent", () => {
  expect(barCells(0, 12)).toEqual({ filled: 0, empty: 12 })
  expect(barCells(50, 12)).toEqual({ filled: 6, empty: 6 })
  expect(barCells(100, 12)).toEqual({ filled: 12, empty: 0 })
})

test("barCells fills at least one cell for a positive percentage and tolerates invalid input", () => {
  expect(barCells(0.4, 12)).toEqual({ filled: 1, empty: 11 })
  expect(barCells(Number.NaN, 12)).toEqual({ filled: 0, empty: 12 })
})
