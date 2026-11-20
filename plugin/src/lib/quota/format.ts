// Quota text formatting shared by the sidebar and the text report.

import type { BalanceQuota, UsageQuota, UsageWindow } from "./types.js"
import { quotaUsedPercent } from "./usage.js"

/**
 * Formats a positive duration in milliseconds into the compact label used by the TUI.
 * `now` is accepted for call-site symmetry with `windowResetText`; the value to format
 * is already a duration in milliseconds.
 */
export function formatDuration(ms: number, now: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "now"
  }

  const minutes = Math.ceil(ms / 60_000)

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  if (hours < 24) {
    if (remainder === 0) {
      return `${hours}h`
    }

    if (remainder === 30) {
      return `${hours}.5h`
    }

    return `${hours}h ${remainder}m`
  }

  const days = Math.floor(hours / 24)
  const hourRemainder = hours % 24

  return hourRemainder === 0 ? `${days}d` : `${days}d ${hourRemainder}h`
}

/** Formats a nullable usage percentage for display. */
const formatPercent = (value: number | null): string =>
  value === null ? "?" : `${Math.round(value)}%`

const CURRENCY_SYMBOLS = new Map([
  ["CNY", "¥"],
  ["EUR", "€"],
  ["GBP", "£"],
  ["JPY", "¥"],
  ["KRW", "₩"],
  ["USD", "$"],
])

/** Formats a remaining balance without implying a percentage or total. */
const formatBalance = (quota: BalanceQuota): string => {
  const symbol = CURRENCY_SYMBOLS.get(quota.unit.toUpperCase())
  const sign = quota.remaining < 0 ? "-" : ""
  const rounded = symbol ? Math.abs(quota.remaining).toFixed(2) : ""

  const displayAmount =
    symbol && quota.remaining !== 0 && Number(rounded) === 0
      ? "<0.01"
      : rounded

  const amount = symbol
    ? `${sign}${symbol}${displayAmount}`
    : `${quota.remaining} ${quota.unit}`

  return `${amount} remaining`
}

/** Formats a count quota, keeping its unit when one is present. */
const formatCountQuota = (
  quota: Extract<UsageQuota, { _tag: "Count" }>
): string => {
  const symbol = CURRENCY_SYMBOLS.get(quota.unit?.toUpperCase() ?? "")

  const amount = (value: number): string => {
    if (symbol) return `${symbol}${value.toFixed(2)}`
    return quota.unit ? `${value} ${quota.unit}` : `${value}`
  }

  return `${amount(quota.current)} / ${amount(quota.total)} used`
}

/** Renders the primary quota text for a window. */
export function formatQuotaText(
  quota: UsageQuota,
  usedSuffix = false
): string {
  if (quota._tag === "Balance") {
    return formatBalance(quota)
  }

  if (quota._tag === "Count") {
    return formatCountQuota(quota)
  }

  const text = formatPercent(quotaUsedPercent(quota))

  return usedSuffix ? `${text} used` : text
}

/** Builds the primary line of text for a usage window. */
export function windowMainText(window: UsageWindow): string {
  return `${window.label}: ${formatQuotaText(window.quota)}`
}

/** Builds the reset suffix for a usage window, or an empty string when unknown. */
export function windowResetText(window: UsageWindow, now: number): string {
  return window.resetsAt === null
    ? ""
    : ` · ${formatDuration(window.resetsAt - now, now)}`
}

/** Renders a Unicode block progress bar for an observed percentage. */
export function percentBar(used: number | null, width: number): string {
  if (used === null || !Number.isFinite(used)) {
    return `[${"░".repeat(width)}]`
  }

  const ratio = used / 100
  let filled = Math.round(ratio * width)

  if (used > 0 && filled === 0) {
    filled = 1
  }

  filled = Math.max(0, Math.min(width, filled))

  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`
}

/** Formats a scaled K/M value with one decimal when needed, never a trailing `.0`. */
function scaledCountText(scaled: number): string {
  const text = scaled.toFixed(1)

  return text.endsWith(".0") ? text.slice(0, -2) : text
}

/** Formats a token count with K/M suffixes and one decimal when needed. */
export function formatTokenCount(value: number): string {
  if (value < 1000) {
    return value.toString()
  }

  if (value < 1_000_000) {
    return `${scaledCountText(value / 1000)}K`
  }

  return `${scaledCountText(value / 1_000_000)}M`
}

/** Formats an epoch-millisecond instant as zero-padded 24-hour HH:MM. */
export function formatTimestamp(ms: number): string {
  const date = new Date(ms)
  const h = date.getHours().toString().padStart(2, "0")
  const m = date.getMinutes().toString().padStart(2, "0")

  return `${h}:${m}`
}

/**
 * Converts a provider-reported window length (in seconds) into a stable display label,
 * matching expected sizes within a 5% tolerance before falling back to the caller's label.
 */
export function limitLabelForWindow(seconds: number, fallback: string): string {
  const minutes = Math.ceil(seconds / 60)

  const roughly = (expected: number) =>
    minutes >= expected * 0.95 && minutes <= expected * 1.05

  const hour = 60
  const day = 24 * hour

  if (roughly(5 * hour)) {
    return "5h"
  }

  if (roughly(day)) {
    return "daily"
  }

  if (roughly(7 * day)) {
    return "weekly"
  }

  if (roughly(30 * day)) {
    return "monthly"
  }

  return fallback
}
