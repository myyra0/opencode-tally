// Claude Code quota adapter: reads the CLI's own native-login credential and queries Anthropic's
// OAuth usage endpoint. Tally never stores or refreshes the token.

import path from "node:path"

import {
  readAuthFileObject,
  resolveCredential,
  type OpenCodeAuth,
} from "../auth.js"
import { runCommand } from "../command.js"
import { ProviderError } from "../errors.js"
import { requestJson } from "../http.js"
import type { ProviderDefinition } from "../registry.js"
import type {
  ClaudeCodeProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "../types.js"
import {
  countQuota,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
} from "../usage.js"

const PROVIDER_ID = "claude-code" as const
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeError = (): ProviderError =>
  new ProviderError({
    kind: "decode",
    providerID: PROVIDER_ID,
    message: "Claude Code response could not be decoded",
  })

const missingCredentials = (message: string): ProviderError =>
  new ProviderError({
    kind: "missing_credentials",
    providerID: PROVIDER_ID,
    message,
  })

const NOT_FOUND_MESSAGE = "Claude Code login was not found. Run `claude auth login`."
const EXPIRED_MESSAGE = "Claude Code login has expired. Run `claude auth login`."

interface ExtractedCredential {
  readonly accessToken: string | undefined
  readonly expiresAt: number | undefined
}

function extractCredential(value: Record<string, unknown> | undefined): ExtractedCredential {
  if (!value) return { accessToken: undefined, expiresAt: undefined }
  const oauth = isRecord(value.claudeAiOauth) ? value.claudeAiOauth : undefined
  const accessToken = resolveCredential(
    typeof oauth?.accessToken === "string" ? oauth.accessToken : undefined
  )
  const expiresAt =
    typeof oauth?.expiresAt === "number" && Number.isFinite(oauth.expiresAt)
      ? oauth.expiresAt
      : undefined
  return { accessToken, expiresAt }
}

function credentialFilePath(config: ClaudeCodeProviderConfig | undefined): string {
  if (config?.authPath) return config.authPath
  const dir = process.env.CLAUDE_CONFIG_DIR
  if (dir && dir.trim() !== "") {
    return path.join(dir, ".credentials.json")
  }
  return "~/.claude/.credentials.json"
}

function addWindow(
  windows: UsageWindow[],
  seen: Set<string>,
  window: UsageWindow
): void {
  const key = `${window.kind}\u0000${window.label}`
  if (seen.has(key)) return
  seen.add(key)
  windows.push(window)
}

export async function fetchClaudeCodeUsage(
  config: ClaudeCodeProviderConfig | undefined,
  auth: OpenCodeAuth,
  timeoutMs: number,
  run: typeof runCommand = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<ProviderUsage<"claude-code">> {
  // 1. config.apiKey
  let accessToken = resolveCredential(config?.apiKey)
  let expiresAt: number | undefined

  // 2. OpenCode Anthropic OAuth
  if (!accessToken) {
    const oauth = resolveCredential(auth?.anthropic?.access)
    if (oauth && oauth.startsWith("sk-ant-oat")) {
      accessToken = oauth
      const oauthExpires = auth?.anthropic?.expires
      if (typeof oauthExpires === "number" && Number.isFinite(oauthExpires)) {
        expiresAt = oauthExpires
      }
    }
  }

  // 3. Credential file
  if (!accessToken) {
    const file = await readAuthFileObject(credentialFilePath(config))
    const extracted = extractCredential(file)
    if (extracted.accessToken) {
      accessToken = extracted.accessToken
      expiresAt = extracted.expiresAt
    }

    // 4. macOS Keychain fallback
    if (!accessToken && platform === "darwin") {
      try {
        const stdout = await run({
          args: ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
          command: "security",
          providerID: PROVIDER_ID,
          timeoutMs,
        })
        const parsed = JSON.parse(stdout)
        const extractedKeychain = extractCredential(
          isRecord(parsed) ? parsed : undefined
        )
        if (extractedKeychain.accessToken) {
          accessToken = extractedKeychain.accessToken
          expiresAt = extractedKeychain.expiresAt
        }
      } catch {
        // ignore; fall through to missing_credentials
      }
    }
  }

  if (!accessToken) {
    throw missingCredentials(NOT_FOUND_MESSAGE)
  }

  if (expiresAt !== undefined && expiresAt < Date.now()) {
    throw missingCredentials(EXPIRED_MESSAGE)
  }

  let payload: unknown
  try {
    payload = await requestJson({
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-dangerous-direct-browser-access": "true",
        "User-Agent": "claude-code/2.1.0",
        "x-app": "cli",
      },
      method: "GET",
      providerID: PROVIDER_ID,
      timeoutMs,
      url: USAGE_URL,
    })
  } catch (error) {
    if (
      error instanceof ProviderError &&
      error.kind === "transport" &&
      (error.status === 401 || error.status === 403)
    ) {
      throw missingCredentials(EXPIRED_MESSAGE)
    }
    throw error
  }

  if (!isRecord(payload)) throw decodeError()

  const windows: UsageWindow[] = []
  const seen = new Set<string>()

  // Modern limits form
  const limits = Array.isArray(payload.limits) ? payload.limits : []
  const modernWindows: UsageWindow[] = []
  for (const entry of limits) {
    if (!isRecord(entry)) continue
    const kind = typeof entry.kind === "string" ? entry.kind : undefined
    if (!kind) continue

    let used: number
    try {
      used = parseUsagePercentage(entry.percent)
    } catch {
      continue
    }

    let windowKind: UsageWindow["kind"]
    let label: string
    if (kind === "session") {
      windowKind = "rolling"
      label = "5h"
    } else if (kind === "weekly_scoped") {
      windowKind = "weekly"
      const scope = isRecord(entry.scope) ? entry.scope : undefined
      const model = isRecord(scope?.model) ? scope.model : undefined
      const displayName =
        typeof model?.display_name === "string" ? model.display_name.trim() : ""
      label = displayName !== "" ? displayName : "weekly"
    } else if (kind === "weekly") {
      windowKind = "weekly"
      label = "weekly"
    } else {
      windowKind = "other"
      label = kind.replaceAll("_", " ")
    }

    modernWindows.push({
      kind: windowKind,
      label,
      quota: percentageQuota(used),
      resetsAt: resetInstantOrNull(entry.resets_at),
    })
  }

  if (modernWindows.length > 0) {
    for (const window of modernWindows) addWindow(windows, seen, window)
  } else {
    // Legacy fields
    const legacyFields: Array<{
      key: string
      kind: UsageWindow["kind"]
      label: string
    }> = [
      { key: "five_hour", kind: "rolling", label: "5h" },
      { key: "seven_day", kind: "weekly", label: "weekly" },
      { key: "seven_day_opus", kind: "weekly", label: "Opus" },
      { key: "seven_day_sonnet", kind: "weekly", label: "Sonnet" },
    ]
    for (const field of legacyFields) {
      const entry = payload[field.key]
      if (entry === null || entry === undefined) continue
      if (!isRecord(entry)) continue
      let used: number
      try {
        used = parseUsagePercentage(entry.utilization)
      } catch {
        continue
      }
      addWindow(windows, seen, {
        kind: field.kind,
        label: field.label,
        quota: percentageQuota(used),
        resetsAt: resetInstantOrNull(entry.resets_at),
      })
    }
  }

  // extra_usage
  const extra = payload.extra_usage
  if (isRecord(extra) && extra.is_enabled === true) {
    const monthlyLimit = extra.monthly_limit
    const usedCredits = extra.used_credits
    const utilization = extra.utilization
    if (
      typeof monthlyLimit === "number" &&
      monthlyLimit > 0 &&
      typeof usedCredits === "number" &&
      Number.isFinite(usedCredits) &&
      typeof utilization === "number" &&
      Number.isFinite(utilization)
    ) {
      try {
        const used = parseUsagePercentage(utilization)
        addWindow(windows, seen, {
          kind: "credits",
          label: "extra usage",
          quota: countQuota(usedCredits, monthlyLimit, used, "USD"),
          resetsAt: resetInstantOrNull(extra.resets_at),
        })
      } catch {
        // skip invalid utilization
      }
    }
  }

  if (windows.length === 0) throw decodeError()

  return {
    capturedAt: Date.now(),
    id: PROVIDER_ID,
    label: config?.label ?? "Claude Code",
    windows,
  }
}

export const claudeCodeProvider: ProviderDefinition<"claude-code"> = {
  defaultLabel: "Claude Code",
  displayOrder: 13,
  fetch: fetchClaudeCodeUsage,
  footerWindowKind: "rolling",
  id: "claude-code",
  openCodeProviderIDs: ["claude-agent", "claude-code"],
}
