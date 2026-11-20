// Alibaba Token Plan adapter. The runtime command executor is injected so tests need no fake executable.
//
// Contract: modelstudioai/cli packages/commands/src/commands/usage/token-plan.ts.
// CLI 2.2.0 replaced the fixed 5-hour/weekly fields with dynamic per<N><Unit> keys
// (Hour/Day/Week/Month) plus `hasQuotaData`. Despite their names, *Percentage fields
// are fractions (0..1), not 0..100.

import type { OpenCodeAuth } from "../auth.js"
import { runCommand } from "../command.js"
import { ProviderError } from "../errors.js"
import type { ProviderDefinition } from "../registry.js"
import type {
  AlibabaTokenPlanProviderConfig,
  ProviderUsage,
  UsageQuota,
  UsageWindow,
} from "../types.js"
import {
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
  unknownQuota,
} from "../usage.js"

const PROVIDER_ID = "alibaba-token-plan" as const
const MINIMUM_CLI_VERSION = [1, 15, 0] as const

const WINDOW_FIELD = /^per(\d+)(Hour|Day|Week|Month)(Percentage|ResetTime)$/u
const UNIT_HOURS: Record<string, number> = {
  Day: 24,
  Hour: 1,
  Month: 720,
  Week: 168,
}

interface ParsedWindow {
  readonly count: number
  readonly unit: string
  percentage?: number
  resetTime?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (message = "Alibaba Token Plan response could not be decoded"): ProviderError =>
  new ProviderError({ kind: "decode", message, providerID: PROVIDER_ID })

/** Reads every per<N><Unit> quota field the CLI reports, oldest window first. */
function readWindows(payload: Record<string, unknown>): ParsedWindow[] {
  const windows = new Map<string, ParsedWindow>()

  for (const [field, value] of Object.entries(payload)) {
    const match = WINDOW_FIELD.exec(field)
    if (!match) continue

    const [, count, unit, kind] = match
    if (count === undefined || unit === undefined || kind === undefined) continue

    const key = `per${count}${unit}`
    const window = windows.get(key) ?? { count: Number(count), unit }

    if (kind === "Percentage") {
      if (value === undefined || value === null) continue
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("Invalid Token Plan ratio")
      }
      window.percentage = value
    } else if (typeof value === "number" && Number.isFinite(value)) {
      window.resetTime = value
    }

    windows.set(key, window)
  }

  return [...windows.values()].sort(
    (left, right) =>
      left.count * (UNIT_HOURS[left.unit] ?? 0) -
      right.count * (UNIT_HOURS[right.unit] ?? 0)
  )
}

function windowKind(window: ParsedWindow): UsageWindow["kind"] {
  if (window.unit === "Hour" && window.count === 5) return "rolling"
  if (window.unit === "Day" && window.count === 1) return "daily"
  if (window.unit === "Week" && window.count === 1) return "weekly"
  if (window.unit === "Month" && window.count === 1) return "monthly"
  return "other"
}

function windowLabel(window: ParsedWindow): string {
  if (window.unit === "Hour" && window.count === 5) return "5h"
  if (window.unit === "Day" && window.count === 1) return "daily"
  if (window.unit === "Week" && window.count === 1) return "weekly"
  if (window.unit === "Month" && window.count === 1) return "monthly"

  const suffix =
    window.unit === "Hour" ? "h" : window.unit === "Day" ? "d" : window.unit === "Week" ? "w" : "mo"
  return `${window.count}${suffix}`
}

function toUsageWindow(window: ParsedWindow): UsageWindow {
  let quota: UsageQuota = unknownQuota

  if (window.percentage !== undefined) {
    try {
      quota = percentageQuota(parseUsagePercentage(window.percentage * 100))
    } catch {
      throw new Error("Invalid Token Plan ratio")
    }
  }

  return {
    kind: windowKind(window),
    label: windowLabel(window),
    quota,
    resetsAt:
      window.resetTime !== undefined && window.resetTime > 0
        ? resetInstantOrNull(new Date(window.resetTime))
        : null,
  }
}

function parseWindows(raw: string): UsageWindow[] {
  const payload: unknown = JSON.parse(raw)

  if (!isRecord(payload)) throw new Error("Invalid Token Plan response")

  const windows = readWindows(payload).map(toUsageWindow)

  if (windows.length > 0) return windows

  // Personal plans default to a single monthly window; the CLI reports no ratio
  // when the plan has no metered usage yet.
  if (payload.hasQuotaData === false) {
    return [{ kind: "monthly", label: "monthly", quota: unknownQuota, resetsAt: null }]
  }

  throw new Error("Token Plan usage windows unavailable")
}

function parseCliVersion(raw: string): [number, number, number] | null {
  const match = raw.match(
    /(?:\bbl\b|\bBailian CLI\b|@bailian\/cli[/@])\s*(?:version\s+)?v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:\D|$)/iu
  )

  if (!match?.groups) return null

  const { major, minor, patch } = match.groups

  return [Number(major), Number(minor), Number(patch)]
}

function hasMinimumCliVersion(actual: readonly number[]): boolean {
  const firstDifference = actual.findIndex(
    (part, index) => part !== MINIMUM_CLI_VERSION[index]
  )

  if (firstDifference === -1) return true

  const actualPart = actual[firstDifference]
  const minimumPart = MINIMUM_CLI_VERSION[firstDifference]

  return (
    actualPart !== undefined &&
    minimumPart !== undefined &&
    actualPart > minimumPart
  )
}

/** Fetches and normalizes Alibaba Token Plan usage through the Bailian CLI. */
export async function fetchAlibabaTokenPlanUsage(
  config: AlibabaTokenPlanProviderConfig | undefined,
  _auth: OpenCodeAuth,
  timeoutMs: number,
  run: typeof runCommand = runCommand
): Promise<ProviderUsage<"alibaba-token-plan">> {
  const china = config?.region === "china"

  const version = await run({
    args: ["--version"],
    command: "bl",
    providerID: PROVIDER_ID,
    timeoutMs,
  })

  const parsedVersion = parseCliVersion(version)

  if (parsedVersion === null) {
    throw decodeError("Bailian CLI version could not be parsed")
  }

  if (!hasMinimumCliVersion(parsedVersion)) {
    throw decodeError("Bailian CLI >= 1.15.0 is required")
  }

  const raw = await run({
    args: [
      "usage",
      "token-plan",
      "--console-region",
      china ? "cn-beijing" : "ap-southeast-1",
      "--console-site",
      china ? "domestic" : "international",
      "--output",
      "json",
    ],
    command: "bl",
    providerID: PROVIDER_ID,
    timeoutMs,
  })

  let windows: UsageWindow[]
  try {
    windows = parseWindows(raw)
  } catch {
    throw decodeError()
  }

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? "Alibaba Token Plan",
    windows,
  }
}

/** Plugin registration for the Alibaba Token Plan adapter. */
export const alibabaTokenPlanProvider: ProviderDefinition<"alibaba-token-plan"> = {
  defaultLabel: "Alibaba Token Plan",
  displayOrder: 7,
  fetch: fetchAlibabaTokenPlanUsage,
  footerWindowKind: "rolling",
  id: PROVIDER_ID,
  openCodeProviderIDs: ["alibaba", "alibaba-cn", "alibaba-token-plan"],
}
