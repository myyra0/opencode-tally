// Provider manifest and lookup helpers, derived from the entries registered here at module evaluation.

import type { OpenCodeAuth } from "./auth.js"
import { claudeCodeProvider } from "./providers/claude-code.js"
import { alibabaTokenPlanProvider } from "./providers/alibaba-token-plan.js"
import { codexProvider } from "./providers/codex.js"
import { commandCodeProvider } from "./providers/commandcode.js"
import { deepSeekProvider } from "./providers/deepseek.js"
import { minimaxProvider } from "./providers/minimax.js"
import { moonshotAiCnProvider, moonshotAiProvider } from "./providers/moonshotai.js"
import { novitaAiProvider } from "./providers/novita-ai.js"
import { openCodeGoProvider } from "./providers/opencode-go.js"
import { openRouterProvider } from "./providers/openrouter.js"
import { qwenProvider } from "./providers/qwen.js"
import { syntheticProvider } from "./providers/synthetic.js"
import { zaiProvider } from "./providers/zai-coding-plan.js"
import type {
  ProviderConfigMap,
  ProviderID,
  ProviderUsage,
  UsageWindowKind,
} from "./types.js"

/** A registered provider adapter and the display metadata that accompanies it. */
export interface ProviderDefinition<ID extends ProviderID = ProviderID> {
  readonly id: ID
  readonly defaultLabel: string
  readonly displayOrder: number
  readonly footerWindowKind: UsageWindowKind
  readonly openCodeProviderIDs: readonly string[]
  fetch(
    config: ProviderConfigMap[ID] | undefined,
    auth: OpenCodeAuth,
    timeoutMs: number,
  ): Promise<ProviderUsage<ID>>
}

/**
 * Canonical display order. Later adapters must use these `displayOrder` values verbatim:
 * codex 0, zai 1, synthetic 2, minimax 3, qwen 4, opencode-go 5, commandcode 6,
 * alibaba-token-plan 7, deepseek 8, novita-ai 9, openrouter 10, moonshotai 11,
 * moonshotai-cn 12. Keeping the full order here lets the snapshot sort configured
 * providers consistently.
 */
export const REFERENCE_PROVIDER_ORDER: readonly ProviderID[] = [
  "codex",
  "zai",
  "synthetic",
  "minimax",
  "qwen",
  "opencode-go",
  "commandcode",
  "alibaba-token-plan",
  "deepseek",
  "novita-ai",
  "openrouter",
  "moonshotai",
  "moonshotai-cn",
  // Tally addition after the 13 reference providers.
  "claude-code",
]

/**
 * Registered adapters, keyed by plugin provider id. Entries are added statically to this
 * literal so they exist at module evaluation: the derived order and lookup helpers below
 * are computed once, not recomputed on mutation.
 */
export const PROVIDER_REGISTRY: Partial<Record<ProviderID, ProviderDefinition<any>>> = {
  codex: codexProvider,
  zai: zaiProvider,
  synthetic: syntheticProvider,
  minimax: minimaxProvider,
  qwen: qwenProvider,
  "opencode-go": openCodeGoProvider,
  commandcode: commandCodeProvider,
  "alibaba-token-plan": alibabaTokenPlanProvider,
  deepseek: deepSeekProvider,
  "novita-ai": novitaAiProvider,
  openrouter: openRouterProvider,
  moonshotai: moonshotAiProvider,
  "moonshotai-cn": moonshotAiCnProvider,
  "claude-code": claudeCodeProvider,
}

/** Registered providers in display order. */
export const PROVIDER_ORDER: readonly ProviderID[] = Object.values(PROVIDER_REGISTRY)
  .slice()
  .sort((left, right) => left.displayOrder - right.displayOrder)
  .map((definition) => definition.id)

/** Display order for a configured provider, using reference values for not-yet-ported adapters. */
export function displayOrderFor(id: ProviderID): number {
  const registered = PROVIDER_REGISTRY[id]
  if (registered) return registered.displayOrder
  return REFERENCE_PROVIDER_ORDER.indexOf(id)
}

/** True only when an adapter has actually been registered for `value`. */
export function isProviderID(value: string): value is ProviderID {
  return (PROVIDER_ORDER as readonly string[]).includes(value)
}

/** Maps an OpenCode provider id to the first registered plugin provider that claims it. */
export function pluginProviderForOpenCode(id: string): ProviderID | null {
  for (const definition of Object.values(PROVIDER_REGISTRY)) {
    if ((definition.openCodeProviderIDs as readonly string[]).includes(id)) return definition.id
  }
  return null
}
