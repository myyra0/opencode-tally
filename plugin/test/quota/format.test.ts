import { expect, test } from "bun:test"

import {
  formatDuration,
  formatQuotaText,
  formatTimestamp,
  formatTokenCount,
  limitLabelForWindow,
  percentBar,
  windowMainText,
  windowResetText,
} from "../../src/lib/quota/format.js"
import {
  balanceQuota,
  countQuota,
  percentageQuota,
  unknownQuota,
} from "../../src/lib/quota/usage.js"

test("formatDuration renders compact durations in milliseconds", () => {
  expect(formatDuration(4 * 3600_000 + 46 * 60_000, 0)).toBe("4h 46m")
  expect(formatDuration(30 * 60_000, 0)).toBe("30m")
  expect(formatDuration(-1, 0)).toBe("now")
})

test("percentBar fills at least one cell for any positive usage", () => {
  expect(percentBar(0, 4)).toBe("[░░░░]")
  expect(percentBar(100, 4)).toBe("[████]")
  expect(percentBar(0.4, 4)).toBe("[█░░░]")
  expect(percentBar(Number.NaN, 4)).toBe("[░░░░]")
})

test("formatTokenCount uses K/M with one decimal when needed", () => {
  expect(formatTokenCount(475_904)).toBe("475.9K")
  expect(formatTokenCount(514_118)).toBe("514.1K")
  expect(formatTokenCount(999)).toBe("999")
  expect(formatTokenCount(1_000_000)).toBe("1M")
})

test("formatTokenCount has no trailing .0 at the K/M rounding boundary", () => {
  expect(formatTokenCount(999_999)).toBe("1000K")
  expect(formatTokenCount(999_999_999)).toBe("1000M")
})

test("limitLabelForWindow normalizes provider window lengths in seconds", () => {
  expect(limitLabelForWindow(5 * 3600, "x")).toBe("5h")
})

test("formatQuotaText renders percentage, balance, count, and unknown quotas", () => {
  expect(formatQuotaText(percentageQuota(42))).toBe("42%")
  expect(formatQuotaText(percentageQuota(42), true)).toBe("42% used")
  expect(formatQuotaText(balanceQuota(12.5, "USD"))).toBe("$12.50 remaining")
  expect(formatQuotaText(countQuota(3, 10, 30, "tokens"))).toBe(
    "3 tokens / 10 tokens used"
  )
  expect(formatQuotaText(countQuota(3, 10, 30))).toBe("3 / 10 used")
  expect(formatQuotaText(unknownQuota, true)).toBe("? used")
})

test("window text helpers render labels and reset suffixes", () => {
  const window = {
    kind: "daily" as const,
    label: "daily",
    quota: percentageQuota(42),
    resetsAt: null,
  }

  expect(windowMainText(window)).toBe("daily: 42%")
  expect(windowResetText(window, 0)).toBe("")
  expect(windowResetText({ ...window, resetsAt: 10 * 60_000 }, 0)).toBe(" · 10m")
})

test("formatTimestamp renders a zero-padded 24-hour HH:MM value", () => {
  const ms = new Date(2026, 0, 1, 9, 5).getTime()

  expect(formatTimestamp(ms)).toBe("09:05")
})
