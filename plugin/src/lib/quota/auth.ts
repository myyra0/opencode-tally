// Credential discovery for quota adapters. Secret values never appear in errors or logs.

import { open } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { ProviderID } from "./types.js"

const MAX_AUTH_FILE_BYTES = 1024 * 1024
const ENV_REFERENCE = /^\{env:([^}]+)\}$/u

export interface OpenCodeAuthEntry {
  readonly key?: string
  readonly apiKey?: string
  readonly access?: string
  readonly accountId?: string
  readonly refresh?: string
  readonly expires?: number
  readonly methodID?: string
  readonly metadata?: Record<string, unknown>
}

/** Provider entries recognized in OpenCode's shared auth file. */
export interface OpenCodeAuth {
  readonly key?: string
  readonly apiKey?: string
  readonly openai?: OpenCodeAuthEntry
  readonly deepseek?: OpenCodeAuthEntry
  readonly moonshotai?: OpenCodeAuthEntry
  readonly "moonshotai-cn"?: OpenCodeAuthEntry
  readonly "zai-coding-plan"?: OpenCodeAuthEntry
  readonly zai?: OpenCodeAuthEntry
  readonly synthetic?: OpenCodeAuthEntry
  readonly "minimax-coding-plan"?: OpenCodeAuthEntry
  readonly minimax?: OpenCodeAuthEntry
  readonly "minimax-token-plan"?: OpenCodeAuthEntry
  readonly "opencode-go"?: OpenCodeAuthEntry
  readonly commandcode?: OpenCodeAuthEntry
  readonly "novita-ai"?: OpenCodeAuthEntry
  readonly openrouter?: OpenCodeAuthEntry
  readonly anthropic?: OpenCodeAuthEntry
  readonly opencode?: OpenCodeAuthEntry
}

type AuthEntryKey = Exclude<keyof OpenCodeAuth, "key" | "apiKey">

const AUTH_ENTRY_KEYS: readonly AuthEntryKey[] = [
  "openai",
  "deepseek",
  "moonshotai",
  "moonshotai-cn",
  "zai-coding-plan",
  "zai",
  "synthetic",
  "minimax-coding-plan",
  "minimax",
  "minimax-token-plan",
  "opencode-go",
  "commandcode",
  "novita-ai",
  "openrouter",
  "anthropic",
  "opencode",
]

const ENTRY_FIELDS = ["key", "apiKey", "access", "accountId", "refresh", "methodID"] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const xdgDataHome = process.env.XDG_DATA_HOME
const platformDataHome =
  process.platform === "win32"
    ? (process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"))
    : path.join(homedir(), ".local", "share")
const DEFAULT_AUTH_PATH = path.join(
  xdgDataHome && path.isAbsolute(xdgDataHome) ? xdgDataHome : platformDataHome,
  "opencode",
  "auth.json"
)

/** Expands a leading `~` (with either separator) to the user's home directory. */
export function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\")
    ? path.join(homedir(), value.slice(2))
    : value
}

/** Resolves a literal credential or a `{env:NAME}` reference; empty values are absent. */
export function resolveCredential(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed === "") {
    return undefined
  }

  const match = ENV_REFERENCE.exec(trimmed)
  const resolved = match ? process.env[match[1] ?? ""]?.trim() : trimmed

  return typeof resolved === "string" && resolved !== ""
    ? resolved
    : undefined
}

/** Reads and parses a size-bounded JSON auth file. */
async function readJsonFile(authPath: string): Promise<unknown> {
  const file = await open(expandHome(authPath), "r")

  try {
    const stats = await file.stat()

    if (stats.size > MAX_AUTH_FILE_BYTES) {
      throw new RangeError("auth file exceeds the size limit")
    }

    const text = await file.readFile({ encoding: "utf8" })

    return JSON.parse(text.toString())
  } finally {
    await file.close()
  }
}

function parseEntry(value: unknown): OpenCodeAuthEntry | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const entry: Record<string, unknown> = {}

  for (const field of ENTRY_FIELDS) {
    const raw = value[field]

    if (typeof raw === "string" && raw.trim() !== "") {
      entry[field] = raw.trim()
    }
  }

  if (typeof value.expires === "number" && Number.isFinite(value.expires)) {
    entry.expires = value.expires
  }

  if (isRecord(value.metadata)) {
    entry.metadata = value.metadata
  }

  return Object.keys(entry).length === 0 ? undefined : (entry as OpenCodeAuthEntry)
}

const readDiagnostic = (error: unknown): string => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "OpenCode auth file was not found"
  }

  if (error instanceof SyntaxError) {
    return "OpenCode auth could not be parsed"
  }

  if (error instanceof RangeError) {
    return "OpenCode auth file is too large"
  }

  return "OpenCode auth could not be read"
}

export interface OpenCodeAuthLoad {
  readonly auth: OpenCodeAuth
  readonly diagnostic?: string
}

/**
 * Loads OpenCode's shared auth file. Missing, unreadable, and malformed files
 * produce a static diagnostic and an empty auth object instead of throwing.
 */
export async function loadOpenCodeAuth(
  authPath: string = DEFAULT_AUTH_PATH
): Promise<OpenCodeAuthLoad> {
  let input: unknown

  try {
    input = await readJsonFile(authPath)
  } catch (error) {
    return { auth: {}, diagnostic: readDiagnostic(error) }
  }

  if (!isRecord(input)) {
    return { auth: {}, diagnostic: "OpenCode auth has an unsupported format" }
  }

  const auth: Partial<Record<AuthEntryKey, OpenCodeAuthEntry>> & {
    key?: string
    apiKey?: string
  } = {}
  const direct = parseEntry(input)

  if (direct) {
    auth.key = direct.key
    auth.apiKey = direct.apiKey
  }

  let malformed = false

  for (const key of AUTH_ENTRY_KEYS) {
    if (!(key in input)) {
      continue
    }

    const entry = parseEntry(input[key])

    if (!entry) {
      malformed = true
      continue
    }

    auth[key] = entry
  }

  return malformed
    ? {
        auth,
        diagnostic: "Some OpenCode auth fields could not be read",
      }
    : { auth }
}

export interface IntegrationCredentialSource {
  list(): Promise<
    | ReadonlyArray<{ id: string }>
    | { readonly data: ReadonlyArray<{ id: string }> }
  >
  connection: {
    active(id: string): Promise<any>
    resolve(connection: any): Promise<any>
  }
}

const INTEGRATION_ALLOWLIST = new Set<string>([
  "openai",
  "anthropic",
  "deepseek",
  "moonshot",
  "moonshotai",
  "moonshotai-cn",
  "minimax",
  "openrouter",
  "synthetic",
  "opencode",
  "opencode-go",
  "zai",
  "z-ai",
  "novita",
  "novita-ai",
  "command-code",
  "commandcode",
  "qwen",
  "alibaba",
  "claude-agent",
  "claude-code",
])

const INTEGRATION_ALIASES: Record<string, readonly string[]> = {
  moonshot: ["moonshotai"],
  minimax: ["minimax-coding-plan", "minimax-token-plan"],
  opencode: ["opencode-go"],
  zai: ["zai", "zai-coding-plan"],
  "z-ai": ["zai", "zai-coding-plan"],
  novita: ["novita-ai"],
  "command-code": ["commandcode"],
}

/** Reads the ChatGPT account id from either the value or its metadata, accepting both spellings. */
function readAccountId(value: Record<string, unknown>): string | undefined {
  const candidates: unknown[] = [value.accountId, value.accountID]
  if (isRecord(value.metadata)) {
    candidates.push(value.metadata.accountId, value.metadata.accountID)
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim()
  }
  return undefined
}

function convertCredential(value: any): OpenCodeAuthEntry | undefined {
  if (!value || typeof value !== "object") return undefined
  if (value.type === "key") {
    const key = typeof value.key === "string" ? value.key.trim() : ""
    if (key === "") return undefined
    return { key }
  }
  if (value.type === "oauth") {
    const access = typeof value.access === "string" ? value.access.trim() : ""
    if (access === "") return undefined
    const entry: any = { access, key: access }
    const accountId = readAccountId(value)
    if (accountId !== undefined) entry.accountId = accountId
    if (typeof value.refresh === "string" && value.refresh.trim() !== "") {
      entry.refresh = value.refresh.trim()
    }
    if (typeof value.expires === "number" && Number.isFinite(value.expires)) {
      entry.expires = value.expires
    }
    if (typeof value.methodID === "string" && value.methodID.trim() !== "") {
      entry.methodID = value.methodID.trim()
    }
    if (isRecord(value.metadata)) {
      entry.metadata = value.metadata
    }
    return entry as OpenCodeAuthEntry
  }
  if (value.type === "external") {
    const entry: any = {}
    if (typeof value.methodID === "string" && value.methodID.trim() !== "") {
      entry.methodID = value.methodID.trim()
    }
    if (isRecord(value.metadata)) {
      entry.metadata = value.metadata
    }
    return Object.keys(entry).length === 0 ? undefined : (entry as OpenCodeAuthEntry)
  }
  return undefined
}

export async function loadOpenCodeAuthWithIntegrations(
  source: IntegrationCredentialSource | undefined,
  authPath: string = DEFAULT_AUTH_PATH,
): Promise<OpenCodeAuthLoad> {
  if (!source) {
    return loadOpenCodeAuth(authPath)
  }

  try {
    const listed: any = await source.list()
    const entries: any[] = Array.isArray(listed)
      ? listed
      : Array.isArray(listed?.data)
        ? listed.data
        : []
    const ids = entries
      .map((item: any) => (item && typeof item.id === "string" ? item.id : undefined))
      .filter((id): id is string => typeof id === "string")
      .filter((id) => INTEGRATION_ALLOWLIST.has(id))

    const auth: Record<string, OpenCodeAuthEntry> & {
      key?: string
      apiKey?: string
    } = {}

    const collected: Array<{ id: string; entry: OpenCodeAuthEntry }> = []
    for (const id of ids) {
      let connection: any
      try {
        connection = await source.connection.active(id)
      } catch {
        continue
      }
      if (!connection || connection.type === "env") continue

      let resolved: any
      try {
        resolved = await source.connection.resolve(connection)
      } catch {
        continue
      }
      if (!resolved) continue

      let entry = convertCredential(resolved)
      if (!entry) continue

      if (id === "openai" && isRecord(resolved.metadata)) {
        const accountID = resolved.metadata.accountID
        if (typeof accountID === "string" && accountID.trim() !== "") {
          entry = { ...entry, accountId: accountID.trim() }
        }
      }

      if (id === "openai" && resolved.type === "oauth" && !entry.methodID) {
        continue
      }

      collected.push({ id, entry })
    }

    // First pass: exact integration ids win.
    for (const { id, entry } of collected) {
      if (auth[id] === undefined) {
        auth[id] = entry
      }
    }

    // Second pass: aliases only when the target is still unset.
    for (const { id, entry } of collected) {
      const aliases = (INTEGRATION_ALIASES[id] ?? []).filter((alias) => alias !== id)
      for (const alias of aliases) {
        if (auth[alias] === undefined) {
          auth[alias] = entry
        }
      }
    }

    // If no entries, fall back
    if (Object.keys(auth).length === 0) {
      return loadOpenCodeAuth(authPath)
    }

    return { auth: auth as OpenCodeAuth }
  } catch {
    return loadOpenCodeAuth(authPath)
  }
}

export type AuthFileCredentialExtractor = (
  value: Record<string, unknown>
) => string | undefined

const credentialFrom = (value: unknown): string | undefined =>
  resolveCredential(typeof value === "string" ? value : undefined)

/** Default lookup order: direct fields, the provider entry, then the opencode alias. */
const makeDefaultExtractor =
  (providerID: ProviderID): AuthFileCredentialExtractor =>
  (value) => {
    const from = (candidate: unknown): string | undefined => {
      if (!isRecord(candidate)) {
        return undefined
      }

      return credentialFrom(candidate.key) ?? credentialFrom(candidate.apiKey)
    }

    return (
      from(value) ?? from(value[providerID]) ?? from(value.opencode)
    )
  }

/**
 * Reads an optional provider-owned auth file as an object. Missing, unreadable,
 * malformed, or non-object files yield `undefined` so callers can continue their
 * provider-specific credential lookup order.
 */
export async function readAuthFileObject(
  authPath: string | undefined
): Promise<Record<string, unknown> | undefined> {
  if (!authPath) {
    return undefined
  }

  try {
    const value = await readJsonFile(authPath)

    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Reads one credential from an optional provider-owned auth file, delegating the
 * file read to `readAuthFileObject` so behavior matches other auth-file consumers.
 */
export async function readAuthFileCredential(
  authPath: string | undefined,
  providerID: ProviderID,
  extract: AuthFileCredentialExtractor = makeDefaultExtractor(providerID)
): Promise<string | undefined> {
  const value = await readAuthFileObject(authPath)

  return value ? extract(value) : undefined
}

/** True when the URL's hostname is exactly the official host (no suffix matching). */
export function officialOrigin(url: string, host: string): boolean {
  try {
    return new URL(url).hostname === host
  } catch {
    return false
  }
}

/** Official origins may use a discovered credential; custom origins must be configured. */
export function pickCredential(input: {
  official: boolean
  discovered?: string
  configured?: string
}): string | undefined {
  return input.official
    ? (input.discovered ?? input.configured)
    : input.configured
}
