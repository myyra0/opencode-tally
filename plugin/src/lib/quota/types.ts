// Config, display, and runtime types shared by the quota subsystem and both UI surfaces.
// Timestamps are epoch milliseconds so RPC payloads stay JSON-safe.

/** Stable semantic window kind independent of its display label. */
export type UsageWindowKind = "rolling" | "daily" | "weekly" | "monthly" | "credits" | "other"

/** Requested sidebar window filter, or all available windows. */
export type SidebarWindow = "all" | UsageWindowKind

/** Requested provider footer window, or the provider's automatic choice. */
export type FooterWindow = "auto" | UsageWindowKind

/** Provider adapters supported by the quota subsystem. */
export type ProviderID =
  | "alibaba-token-plan"
  | "codex"
  | "deepseek"
  | "zai"
  | "synthetic"
  | "minimax"
  | "moonshotai"
  | "moonshotai-cn"
  | "qwen"
  | "opencode-go"
  | "commandcode"
  | "novita-ai"
  | "openrouter"
  | "claude-code"

/** Resolved display settings for one provider. */
export interface ProviderDisplayConfig {
  showSidebarBar: boolean
  sidebarWindow: SidebarWindow
  showFooterBar: boolean
  footerWindow: FooterWindow
}

/** Fields shared by every provider config entry. */
export interface CommonProviderConfig {
  enabled?: boolean
  label?: string
  showSidebarBar?: boolean
  sidebarWindow?: SidebarWindow
  /** Accepted from pasted usage-limits configs but not rendered by this plugin. */
  showFooterBar?: boolean
  /** Accepted from pasted usage-limits configs but not rendered by this plugin. */
  footerWindow?: FooterWindow
}

export interface CodexProviderConfig extends CommonProviderConfig {
  authPath?: string
  baseUrl?: string
  apiKey?: string
  authorizationScheme?: "raw" | "bearer"
}

export interface ZaiProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  authorizationScheme?: "raw" | "bearer"
}

export interface SyntheticProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  baseUrl?: string
}

export interface MiniMaxProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  baseUrl?: string
}

export interface DeepSeekProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  baseUrl?: string
}

export interface MoonshotAiProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  baseUrl?: string
}

export interface NovitaAiProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  baseUrl?: string
}

export interface OpenRouterProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  baseUrl?: string
}

export type QwenProviderConfig = CommonProviderConfig

export interface AlibabaTokenPlanProviderConfig extends CommonProviderConfig {
  region?: "international" | "china"
}

export interface OpenCodeGoProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  baseUrl?: string
}

export interface CommandCodeProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
  baseUrl?: string
}

export interface ClaudeCodeProviderConfig extends CommonProviderConfig {
  apiKey?: string
  authPath?: string
}

/** Provider configuration indexed by literal provider ID. */
export interface ProviderConfigMap {
  "alibaba-token-plan": AlibabaTokenPlanProviderConfig
  codex: CodexProviderConfig
  deepseek: DeepSeekProviderConfig
  minimax: MiniMaxProviderConfig
  moonshotai: MoonshotAiProviderConfig
  "moonshotai-cn": MoonshotAiProviderConfig
  "novita-ai": NovitaAiProviderConfig
  openrouter: OpenRouterProviderConfig
  qwen: QwenProviderConfig
  synthetic: SyntheticProviderConfig
  zai: ZaiProviderConfig
  "opencode-go": OpenCodeGoProviderConfig
  commandcode: CommandCodeProviderConfig
  "claude-code": ClaudeCodeProviderConfig
}

export type ProviderConfig = ProviderConfigMap[ProviderID]

/** Sidebar section ids, in canonical render order. */
export type SidebarSection = "quota" | "context" | "recorded" | "contextWindow"

export interface SidebarConfig {
  enabled: boolean
  refreshSeconds: number
  sections: SidebarSection[]
  showBars: boolean
  showPercentages: boolean
  showWarnings: boolean
  showUpdated: boolean
}

export interface QuotaConfig {
  enabled: boolean
  refreshIntervalSeconds: number
  requestTimeoutMs: number
  showErrors: boolean
  providers: Partial<ProviderConfigMap>
}

// Runtime quota value and state types shared by the adapters and the snapshot.

/** A remaining balance without a known total or usage percentage. */
export interface BalanceQuota {
  readonly _tag: "Balance"
  readonly remaining: number
  readonly unit: string
}

/** Normalized quota representation exposed by a usage window. */
export type UsageQuota =
  | {
      readonly _tag: "Percentage"
      readonly remainingPercent: number
      readonly usedPercent: number
    }
  | {
      readonly _tag: "Count"
      readonly current: number
      readonly remainingPercent: number
      readonly total: number
      readonly unit?: string
      readonly usedPercent: number
    }
  | BalanceQuota
  | { readonly _tag: "Unknown" }

/** One provider quota window, keyed by a stable semantic kind. */
export interface UsageWindow {
  readonly kind: UsageWindowKind
  readonly label: string
  readonly quota: UsageQuota
  /** Absolute reset instant in epoch milliseconds, when reported. */
  readonly resetsAt: number | null
}

/** Normalized usage payload returned by each provider adapter. */
export interface ProviderUsage<ID extends ProviderID = ProviderID> {
  readonly id: ID
  readonly label: string
  readonly tierName?: string
  /** Time this snapshot was captured, in epoch milliseconds. */
  readonly capturedAt: number
  readonly windows: readonly UsageWindow[]
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>
}

/** Structured provider error categories used by UI behavior. */
export type ProviderErrorKind =
  | "missing_credentials"
  | "transport"
  | "rate_limit"
  | "timeout"
  | "decode"
  | "command"
  | "config"

/** UI state for a provider across refresh cycles. */
export type ProviderState =
  | { id: ProviderID; label: string; status: "disabled" }
  | { id: ProviderID; label: string; status: "loading" }
  | {
      id: ProviderID
      label: string
      status: "ready"
      data: ProviderUsage
      stale: boolean
    }
  | {
      id: ProviderID
      label: string
      status: "error"
      message: string
      errorKind?: ProviderErrorKind
      previous?: ProviderUsage
    }

/** Serializable view returned by the quota RPC and consumed by every surface. */
export interface QuotaView {
  states: ProviderState[]
  providerDisplays: Partial<Record<ProviderID, ProviderDisplayConfig>>
  diagnostics: string[]
  /** Time of the most recent completed refresh in epoch milliseconds, or null before the first refresh. */
  updatedAt: number | null
  showErrors: boolean
}
