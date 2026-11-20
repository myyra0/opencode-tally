// Qwen Token Plan adapter. The runtime command executor is injected so tests need no fake executable.

import type { OpenCodeAuth } from "../auth.js"
import { runCommand } from "../command.js"
import { ProviderError } from "../errors.js"
import type { ProviderDefinition } from "../registry.js"
import type {
  ProviderUsage,
  QwenProviderConfig,
  UsageQuota,
  UsageWindow,
} from "../types.js"
import {
  countQuota,
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
} from "../usage.js"

const DEFAULT_CLI = "qwencloud"
const PROVIDER_ID = "qwen" as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

interface QwenTokenPlan {
  readonly planName?: string
  readonly remainingCredits?: number
  readonly resetDate?: string
  readonly subscribed: boolean
  readonly totalCredits?: number
  readonly usedPct?: number
}

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    message: "Qwen response could not be decoded",
    providerID: PROVIDER_ID,
  })

const missingCredentials = (): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    message: "Qwen credentials are missing",
    providerID: PROVIDER_ID,
  })

/** Reads the boolean authentication state from `qwencloud auth status` output. */
function parseAuthStatus(raw: string): boolean {
  let authenticated = false
  let serverVerified = true

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) throw new Error("not an object")

    authenticated = parsed.authenticated === true
    if (typeof parsed.server_verified === "boolean") {
      serverVerified = parsed.server_verified
    }
  } catch {
    throw new Error("Failed to parse qwencloud auth status")
  }

  return authenticated && serverVerified
}

/** Reads the token_plan section from `qwencloud usage summary` output. */
function parseTokenPlan(raw: string): QwenTokenPlan {
  let plan: QwenTokenPlan = { subscribed: false }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) throw new Error("not an object")

    const tokenPlan = isRecord(parsed.token_plan) ? parsed.token_plan : undefined

    if (tokenPlan) {
      plan = {
        planName:
          typeof tokenPlan.planName === "string" ? tokenPlan.planName : undefined,
        remainingCredits:
          typeof tokenPlan.remainingCredits === "number"
            ? tokenPlan.remainingCredits
            : undefined,
        resetDate:
          typeof tokenPlan.resetDate === "string"
            ? tokenPlan.resetDate
            : undefined,
        subscribed: tokenPlan.subscribed === true,
        totalCredits:
          typeof tokenPlan.totalCredits === "number"
            ? tokenPlan.totalCredits
            : undefined,
        usedPct:
          typeof tokenPlan.usedPct === "number" ? tokenPlan.usedPct : undefined,
      }
    }
  } catch {
    throw new Error("Failed to parse qwencloud usage response")
  }

  return plan
}

/** Builds the single aggregate credits window, or null when no percentage is reported. */
function buildQwenWindow(plan: QwenTokenPlan): UsageWindow | null {
  if (!plan.subscribed) return null

  let used: number
  try {
    used = parseUsagePercentage(plan.usedPct)
  } catch {
    return null
  }

  let resetsAt: number | null = null
  if (plan.resetDate !== undefined) {
    const parsed = new Date(plan.resetDate)
    if (!Number.isNaN(parsed.getTime())) resetsAt = resetInstantOrNull(parsed)
  }

  let total: number | undefined
  let remaining: number | undefined
  try {
    total = parseUsageCount(plan.totalCredits)
  } catch {
    total = undefined
  }
  try {
    remaining = parseUsageCount(plan.remainingCredits)
  } catch {
    remaining = undefined
  }

  let current: number | undefined
  if (total !== undefined && remaining !== undefined && remaining <= total) {
    try {
      current = parseUsageCount(total - remaining)
    } catch {
      current = undefined
    }
  }

  let quota: UsageQuota
  if (total !== undefined && current !== undefined) {
    quota = countQuota(current, total, used)
  } else {
    quota = percentageQuota(used)
  }

  return { kind: "credits", label: "credits", quota, resetsAt }
}

/** Fetches and normalizes Qwen Token Plan usage through the runtime command layer. */
export async function fetchQwenTokenPlanUsage(
  config: QwenProviderConfig | undefined,
  _auth: OpenCodeAuth,
  timeoutMs: number,
  run: typeof runCommand = runCommand
): Promise<ProviderUsage<"qwen">> {
  const authRaw = await run({
    acceptedExitCodes: new Set([2]),
    args: ["auth", "status", "--format", "json"],
    command: DEFAULT_CLI,
    providerID: PROVIDER_ID,
    timeoutMs,
  })

  let authenticated: boolean
  try {
    authenticated = parseAuthStatus(authRaw)
  } catch {
    throw decodeError()
  }

  if (!authenticated) throw missingCredentials()

  const usageRaw: string = await run({
    args: ["usage", "summary", "--format", "json"],
    command: DEFAULT_CLI,
    providerID: PROVIDER_ID,
    timeoutMs,
  })

  let plan: QwenTokenPlan
  try {
    plan = parseTokenPlan(usageRaw)
  } catch {
    throw decodeError()
  }

  const window = buildQwenWindow(plan)
  if (!plan.subscribed || !window) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? plan.planName ?? "Qwen Token Plan",
    windows: [window],
  }
}

/** Plugin registration for the Qwen Token Plan provider adapter. */
export const qwenProvider: ProviderDefinition<"qwen"> = {
  defaultLabel: "Qwen",
  displayOrder: 4,
  fetch: fetchQwenTokenPlanUsage,
  footerWindowKind: "credits",
  id: PROVIDER_ID,
  openCodeProviderIDs: ["bailian-token-plan-personal", "qwen"],
}
