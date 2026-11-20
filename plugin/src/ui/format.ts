// Number, percent, currency, and bar formatting shared by the panel and the sidebar.
// Token scaling and durations come from the quota module; this file only adds the presentation
// choices that differ between surfaces.

import { formatTokenCount } from "../lib/quota/format.js"

const integer = new Intl.NumberFormat("en-US")

/** Compact K/M for the sidebar (lowercase suffix), exact grouped integer for the panel. */
export function formatTokens(value: number, compact: boolean): string {
  return compact ? formatTokenCount(value).toLowerCase() : integer.format(value)
}

/** Percentage of `part` in `whole`, or empty when the whole is unknown/zero. */
export function formatPercent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : ""
}

/** Currency value with the two-decimal precision used by cost rows and balances. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(value !== 0 && Math.abs(value) < 0.01 ? 4 : 2)}`
}

/** Re-export so both surfaces format reset countdowns from the same source. */
export { formatDuration } from "../lib/quota/format.js"

/** Filled and empty bar cells for a percentage, with the quota module's one-cell minimum. */
export function barCells(percent: number, width: number): { filled: number; empty: number } {
  if (!Number.isFinite(percent) || percent <= 0) {
    return { filled: 0, empty: width }
  }

  const filled = Math.max(1, Math.min(width, Math.round((percent / 100) * width)))

  return { filled, empty: width - filled }
}
