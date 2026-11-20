// Settings loading, bundled pricing, and tokenizer model maps.

import path from "path"
import fs from "fs/promises"
import { homedir } from "os"
import { fileURLToPath } from "url"
import type { TokenizerSpec, ModelPricing, TallyConfig } from "./types.js"
import { parseJsonc } from "./jsonc.js"
import type { ProviderConfigMap, QuotaConfig, SidebarConfig, SidebarSection } from "./quota/types.js"

export const DEFAULT_ENTRY_LIMIT = 3
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const USER_TALLY_CONFIG_PATH = path.join(homedir(), ".config", "opencode", "tally-config.json")
const BUNDLED_ASSET_PATH_CACHE = new Map<string, string>()

export async function resolveBundledAssetPath(filename: string, moduleDir = MODULE_DIR): Promise<string> {
  const cacheKey = `${moduleDir}:${filename}`
  const cached = BUNDLED_ASSET_PATH_CACHE.get(cacheKey)
  if (cached) return cached

  // Bundled assets live at the package root: two levels up from src/lib (and dist/lib).
  const candidates = [path.join(moduleDir, "../..", filename)]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      BUNDLED_ASSET_PATH_CACHE.set(cacheKey, candidate)
      return candidate
    } catch {}
  }

  const fallback = candidates[0]
  BUNDLED_ASSET_PATH_CACHE.set(cacheKey, fallback)
  return fallback
}

// Pricing cache
let PRICING_CACHE: Record<string, ModelPricing> | null = null

// The bundled models.json is a fallback snapshot of model pricing.
// Live OpenCode model metadata takes precedence when it is available.
export async function loadModelPricing(): Promise<Record<string, ModelPricing>> {
  if (PRICING_CACHE) return PRICING_CACHE

  try {
    const modelsPath = await resolveBundledAssetPath("models.json")
    const data = await fs.readFile(modelsPath, "utf8")
    PRICING_CACHE = JSON.parse(data)
    return PRICING_CACHE!
  } catch {
    PRICING_CACHE = { default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 } }
    return PRICING_CACHE
  }
}

// Tally config defaults and loader

export const DEFAULT_TALLY_CONFIG: TallyConfig = {
  enableContextBreakdown: true,
  enableToolSchemaEstimation: true,
  enableCacheEfficiency: true,
  enableSubagentAnalysis: true,
  enableDetailedSubagentCostBreakdown: false,
  enableSkillAnalysis: true,
}

export const DEFAULT_SIDEBAR_CONFIG: SidebarConfig = {
  enabled: true,
  refreshSeconds: 60,
  sections: ["quota", "context", "recorded", "contextWindow"],
  showBars: true,
  showPercentages: true,
  showWarnings: true,
  showUpdated: true,
}

export const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  enabled: true,
  refreshIntervalSeconds: 60,
  requestTimeoutMs: 10000,
  showErrors: true,
  providers: {},
}

const SIDEBAR_SECTION_IDS: readonly string[] = ["quota", "context", "recorded", "contextWindow"]
const TALLY_FILE_CONFIG_CACHE = new Map<string, TallyConfig>()
const SIDEBAR_LAST_VALID = new Map<string, SidebarConfig>()
const QUOTA_LAST_VALID = new Map<string, QuotaConfig>()
let BUNDLED_CONFIG_CACHE: Record<string, unknown> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asSection(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

async function readConfigFile(configPath: string): Promise<{ data: Record<string, unknown> | null; diagnostic?: string }> {
  let text: string
  try {
    text = await fs.readFile(configPath, "utf8")
  } catch {
    return { data: null }
  }

  try {
    const parsed = parseJsonc(text)
    if (!isRecord(parsed)) return { data: null, diagnostic: `Config ${configPath} must contain a JSON object` }
    return { data: parsed }
  } catch {
    // Never surface the parser's message: it can quote a slice of the file, including secrets.
    return { data: null, diagnostic: `Could not parse ${configPath}; check the JSON syntax.` }
  }
}

async function loadBundledConfig(): Promise<Record<string, unknown>> {
  if (BUNDLED_CONFIG_CACHE) return BUNDLED_CONFIG_CACHE
  const bundledConfigPath = await resolveBundledAssetPath("tally-config.json")
  const { data } = await readConfigFile(bundledConfigPath)
  BUNDLED_CONFIG_CACHE = data ?? {}
  return BUNDLED_CONFIG_CACHE
}

async function loadTallyFileConfig(configPath: string): Promise<TallyConfig> {
  const cached = TALLY_FILE_CONFIG_CACHE.get(configPath)
  if (cached) return cached

  const { data: userConfig } = await readConfigFile(configPath)
  const bundledConfig = userConfig ? null : await loadBundledConfig()

  const value = {
    ...DEFAULT_TALLY_CONFIG,
    ...(bundledConfig ?? {}),
    ...(userConfig ?? {}),
  } as TallyConfig

  TALLY_FILE_CONFIG_CACHE.set(configPath, value)
  return value
}

// Plugin options in opencode.json use the same keys as tally-config.json.
function readPluginOptions(options: Readonly<Record<string, unknown>>): Partial<TallyConfig> {
  const overrides: Partial<TallyConfig> = {}
  for (const key of Object.keys(DEFAULT_TALLY_CONFIG) as Array<keyof TallyConfig>) {
    const value = options[key]
    if (typeof value === "boolean") overrides[key] = value
  }
  return overrides
}

/**
 * Resolves the effective config. Precedence, highest first: plugin options from opencode.json,
 * the user file, the bundled tally-config.json, built-in defaults.
 * `configPath` overrides the user file location for callers that supply their own file.
 */
export async function loadTallyConfig(
  pluginOptions: Readonly<Record<string, unknown>> = {},
  configPath = USER_TALLY_CONFIG_PATH,
): Promise<TallyConfig> {
  return { ...(await loadTallyFileConfig(configPath)), ...readPluginOptions(pluginOptions) }
}

function readBoolean(
  raw: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
  previousValue: boolean,
  diagnostics: string[],
  label: string,
): boolean {
  const value = raw[key]
  if (value === undefined) return defaultValue
  if (typeof value === "boolean") return value
  diagnostics.push(`Invalid ${label}.${key}: expected a boolean. Keeping previous value.`)
  return previousValue
}

function readBoundedNumber(
  raw: Record<string, unknown>,
  key: string,
  min: number,
  requireInteger: boolean,
  defaultValue: number,
  previousValue: number,
  diagnostics: string[],
  label: string,
): number {
  const value = raw[key]
  if (value === undefined) return defaultValue
  const valid =
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    (!requireInteger || Number.isInteger(value))
  if (valid) return value as number
  diagnostics.push(
    `Invalid ${label}.${key}: ${String(value)}; must be ${requireInteger ? "an integer " : ""}>= ${min}. Keeping previous value.`,
  )
  return previousValue
}

function readSections(
  raw: Record<string, unknown>,
  defaultValue: SidebarSection[],
  previousValue: SidebarSection[],
  diagnostics: string[],
): SidebarSection[] {
  const value = raw.sections
  if (value === undefined) return [...defaultValue]
  if (!Array.isArray(value)) {
    diagnostics.push("Invalid sidebar.sections: expected an array. Keeping previous value.")
    return [...previousValue]
  }

  const sections: SidebarSection[] = []
  for (const entry of value) {
    if (typeof entry === "string" && SIDEBAR_SECTION_IDS.includes(entry)) sections.push(entry as SidebarSection)
    else diagnostics.push(`Unknown sidebar section: ${String(entry)}`)
  }
  return sections.length > 0 ? sections : [...DEFAULT_SIDEBAR_CONFIG.sections]
}

/** Loads and validates the sidebar section, retaining the last valid value on invalid input. */
export async function loadSidebarConfig(
  configPath = USER_TALLY_CONFIG_PATH,
): Promise<{ value: SidebarConfig; diagnostics: string[] }> {
  const { data, diagnostic } = await readConfigFile(configPath)
  const previous = SIDEBAR_LAST_VALID.get(configPath) ?? DEFAULT_SIDEBAR_CONFIG
  if (diagnostic) return { value: { ...previous }, diagnostics: [diagnostic] }

  const bundled = await loadBundledConfig()
  const raw = { ...asSection(bundled.sidebar), ...asSection(data?.sidebar) }
  const diagnostics: string[] = []

  const defaults = DEFAULT_SIDEBAR_CONFIG
  const value: SidebarConfig = {
    enabled: readBoolean(raw, "enabled", defaults.enabled, previous.enabled, diagnostics, "sidebar"),
    refreshSeconds: readBoundedNumber(
      raw,
      "refreshSeconds",
      15,
      true,
      defaults.refreshSeconds,
      previous.refreshSeconds,
      diagnostics,
      "sidebar",
    ),
    sections: readSections(raw, defaults.sections, previous.sections, diagnostics),
    showBars: readBoolean(raw, "showBars", defaults.showBars, previous.showBars, diagnostics, "sidebar"),
    showPercentages: readBoolean(raw, "showPercentages", defaults.showPercentages, previous.showPercentages, diagnostics, "sidebar"),
    showWarnings: readBoolean(raw, "showWarnings", defaults.showWarnings, previous.showWarnings, diagnostics, "sidebar"),
    showUpdated: readBoolean(raw, "showUpdated", defaults.showUpdated, previous.showUpdated, diagnostics, "sidebar"),
  }

  SIDEBAR_LAST_VALID.set(configPath, value)
  return { value, diagnostics }
}

/** Loads and validates the quota section, retaining the last valid value on invalid input. */
export async function loadQuotaConfig(
  configPath = USER_TALLY_CONFIG_PATH,
): Promise<{ value: QuotaConfig; diagnostics: string[] }> {
  const { data, diagnostic } = await readConfigFile(configPath)
  const previous = QUOTA_LAST_VALID.get(configPath) ?? DEFAULT_QUOTA_CONFIG
  if (diagnostic) return { value: { ...previous }, diagnostics: [diagnostic] }

  const bundled = await loadBundledConfig()
  const raw = { ...asSection(bundled.quota), ...asSection(data?.quota) }
  const diagnostics: string[] = []

  const rawProviders = raw.providers
  const defaults = DEFAULT_QUOTA_CONFIG
  let providers: Partial<ProviderConfigMap>
  if (rawProviders === undefined) providers = { ...defaults.providers }
  else if (isRecord(rawProviders)) providers = { ...rawProviders } as Partial<ProviderConfigMap>
  else {
    diagnostics.push("Invalid quota.providers: expected an object. Keeping previous value.")
    providers = { ...previous.providers }
  }

  const value: QuotaConfig = {
    enabled: readBoolean(raw, "enabled", defaults.enabled, previous.enabled, diagnostics, "quota"),
    refreshIntervalSeconds: readBoundedNumber(
      raw,
      "refreshIntervalSeconds",
      15,
      true,
      defaults.refreshIntervalSeconds,
      previous.refreshIntervalSeconds,
      diagnostics,
      "quota",
    ),
    requestTimeoutMs: readBoundedNumber(
      raw,
      "requestTimeoutMs",
      1000,
      false,
      defaults.requestTimeoutMs,
      previous.requestTimeoutMs,
      diagnostics,
      "quota",
    ),
    showErrors: readBoolean(raw, "showErrors", defaults.showErrors, previous.showErrors, diagnostics, "quota"),
    providers,
  }

  QUOTA_LAST_VALID.set(configPath, value)
  return { value, diagnostics }
}

// OpenAI model mapping for tiktoken
export const OPENAI_MODEL_MAP: Record<string, string> = {
  "gpt-5": "gpt-4o",
  "o4-mini": "gpt-4o",
  "o3": "gpt-4o",
  "o3-mini": "gpt-4o",
  "o1": "gpt-4o",
  "o1-pro": "gpt-4o",
  "gpt-4.1": "gpt-4o",
  "gpt-4.1-mini": "gpt-4o",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4-turbo": "gpt-4",
  "gpt-4": "gpt-4",
  "gpt-3.5-turbo": "gpt-3.5-turbo",
  "text-embedding-3-large": "text-embedding-3-large",
  "text-embedding-3-small": "text-embedding-3-small",
  "text-embedding-ada-002": "text-embedding-ada-002",
}

// Hugging Face tokenizer model mapping
export const HUGGINGFACE_TOKENIZER_MODEL_MAP: Record<string, string> = {
  "claude-opus-4": "Xenova/claude-tokenizer",
  "claude-sonnet-4": "Xenova/claude-tokenizer",
  "claude-3.7-sonnet": "Xenova/claude-tokenizer",
  "claude-3.5-sonnet": "Xenova/claude-tokenizer",
  "claude-3.5-haiku": "Xenova/claude-tokenizer",
  "claude-3-opus": "Xenova/claude-tokenizer",
  "claude-3-sonnet": "Xenova/claude-tokenizer",
  "claude-3-haiku": "Xenova/claude-tokenizer",
  "claude-2.1": "Xenova/claude-tokenizer",
  "claude-2.0": "Xenova/claude-tokenizer",
  "claude-instant-1.2": "Xenova/claude-tokenizer",
  "llama-4": "Xenova/llama4-tokenizer",
  "llama-3.3": "unsloth/Llama-3.3-70B-Instruct",
  "llama-3.2": "Xenova/Llama-3.2-Tokenizer",
  "llama-3.1": "Xenova/Meta-Llama-3.1-Tokenizer",
  "llama-3": "Xenova/llama3-tokenizer-new",
  "llama-2": "Xenova/llama2-tokenizer",
  "code-llama": "Xenova/llama-code-tokenizer",
  "deepseek-r1": "deepseek-ai/DeepSeek-R1",
  "deepseek-v3": "deepseek-ai/DeepSeek-V3",
  "deepseek-v2": "deepseek-ai/DeepSeek-V2",
  "mistral-large": "Xenova/mistral-tokenizer-v3",
  "mistral-small": "Xenova/mistral-tokenizer-v3",
  "mistral-nemo": "Xenova/Mistral-Nemo-Instruct-Tokenizer",
  "devstral-small": "Xenova/Mistral-Nemo-Instruct-Tokenizer",
  "codestral": "Xenova/mistral-tokenizer-v3",
}

// Provider default tokenizers
export const PROVIDER_DEFAULTS: Record<string, TokenizerSpec> = {
  anthropic: { kind: "huggingface", hub: "Xenova/claude-tokenizer" },
  meta: { kind: "huggingface", hub: "Xenova/Meta-Llama-3.1-Tokenizer" },
  mistral: { kind: "huggingface", hub: "Xenova/mistral-tokenizer-v3" },
  deepseek: { kind: "huggingface", hub: "deepseek-ai/DeepSeek-V3" },
}
