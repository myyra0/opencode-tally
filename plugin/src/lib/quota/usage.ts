// Quota arithmetic and validation shared by the provider adapters.

import type { BalanceQuota, UsageQuota } from "./types.js"

/** Validates a finite percentage in the inclusive range 0..100. */
export function parseUsagePercentage(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new RangeError("usage percentage must be a finite number between 0 and 100")
  }

  return value
}

/** Validates a finite, non-negative quota count. */
export function parseUsageCount(value: unknown, label = "quota count"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number`)
  }

  return value
}

/** Parses a provider reset value into epoch milliseconds, or null when invalid. */
export function resetInstantOrNull(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime()

    return Number.isFinite(ms) ? ms : null
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === "string") {
    const ms = Date.parse(value)

    return Number.isFinite(ms) ? ms : null
  }

  return null
}

/** Creates a percentage quota and derives its complementary remaining percentage. */
export function percentageQuota(used: number): UsageQuota {
  const usedPercent = parseUsagePercentage(used)

  return {
    _tag: "Percentage",
    remainingPercent: 100 - usedPercent,
    usedPercent,
  }
}

/** Creates a count quota with a percentage projection, rejecting current > total. */
export function countQuota(
  current: number,
  total: number,
  used: number,
  unit?: string
): UsageQuota {
  const currentCount = parseUsageCount(current, "quota current count")
  const totalCount = parseUsageCount(total, "quota total count")
  const usedPercent = parseUsagePercentage(used)

  if (currentCount > totalCount) {
    throw new RangeError("quota current count cannot exceed total count")
  }

  const quota = {
    _tag: "Count" as const,
    current: currentCount,
    remainingPercent: 100 - usedPercent,
    total: totalCount,
    usedPercent,
  }

  return unit === undefined ? quota : { ...quota, unit }
}

/** Creates a remaining-balance quota without inventing a total or percentage. */
export function balanceQuota(remaining: number, unit: string): BalanceQuota {
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
    throw new RangeError("quota balance must be a finite number")
  }

  if (typeof unit !== "string") {
    throw new TypeError("quota balance unit must be a string")
  }

  return { _tag: "Balance", remaining, unit }
}

/** Quota sentinel for providers that cannot report meaningful usage. */
export const unknownQuota: UsageQuota = { _tag: "Unknown" }

/** Gets the used percentage when a quota reports consumption, otherwise null. */
export function quotaUsedPercent(quota: UsageQuota): number | null {
  return quota._tag === "Percentage" || quota._tag === "Count"
    ? quota.usedPercent
    : null
}
