import { expect, test } from "bun:test"

import {
  balanceQuota,
  countQuota,
  parseUsagePercentage,
  percentageQuota,
  quotaUsedPercent,
  resetInstantOrNull,
  unknownQuota,
} from "../../src/lib/quota/usage.js"

test("percentage quotas normalize used and remaining percentages", () => {
  expect(quotaUsedPercent(percentageQuota(42))).toBe(42)
  expect(percentageQuota(42)).toMatchObject({
    _tag: "Percentage",
    usedPercent: 42,
    remainingPercent: 58,
  })
  expect(() => percentageQuota(101)).toThrow()
})

test("balance quotas are not percentages", () => {
  expect(quotaUsedPercent(balanceQuota(12.5, "USD"))).toBeNull()
  expect(balanceQuota(12.5, "USD")).toMatchObject({
    _tag: "Balance",
    remaining: 12.5,
    unit: "USD",
  })
})

test("count quotas carry counts and a percentage projection", () => {
  expect(countQuota(3, 10, 30)).toMatchObject({
    _tag: "Count",
    current: 3,
    total: 10,
    usedPercent: 30,
  })
  expect(() => countQuota(11, 10, 50)).toThrow()
})

test("parseUsagePercentage validates the 0..100 range", () => {
  expect(parseUsagePercentage(0)).toBe(0)
  expect(parseUsagePercentage(100)).toBe(100)
  expect(() => parseUsagePercentage(-1)).toThrow()
  expect(() => parseUsagePercentage(101)).toThrow()
  expect(() => parseUsagePercentage(Number.NaN)).toThrow()
})

test("resetInstantOrNull returns epoch milliseconds or null", () => {
  expect(resetInstantOrNull("2026-01-01T00:00:00.000Z")).toBe(1767225600000)
  expect(resetInstantOrNull("not-a-date")).toBeNull()
})

test("unknown quotas have no percentage", () => {
  expect(quotaUsedPercent(unknownQuota)).toBeNull()
  expect(unknownQuota).toMatchObject({ _tag: "Unknown" })
})
