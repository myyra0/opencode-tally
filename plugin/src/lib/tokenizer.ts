// Token counting across tiktoken, Hugging Face, and approximate backends.

import type { TokenModel } from "./types.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"

const APPROXIMATE_ONLY_HUGGINGFACE_HUBS = new Set(["google/gemma-2-9b-it"])

interface TiktokenEncoder {
  encode(text: string): number[]
}

interface TiktokenEntry {
  encoder: TiktokenEncoder
  warning?: string
  warningKey?: string
}

interface HuggingFaceTokenizer {
  encode(text: string): Promise<{ ids: number[] }>
}

interface HuggingFaceEntry {
  tokenizer: HuggingFaceTokenizer | null
  warning?: string
  warningKey?: string
}

interface TiktokenModule {
  encodingForModel?: (model: string) => TiktokenEncoder
  getEncoding?: (name: string) => TiktokenEncoder
  default?: {
    encodingForModel?: (model: string) => TiktokenEncoder
    getEncoding?: (name: string) => TiktokenEncoder
  }
}

interface HuggingFaceTokenizersModule {
  Tokenizer: new (json: unknown, config: unknown) => HuggingFaceTokenizer
}

// These live at module scope so a fresh manager (for example a sidebar refresh) reuses
// tokenizers already loaded in this process instead of downloading them again.
const tiktokenCache = new Map<string, TiktokenEntry>()
const huggingFaceTokenizerCache = new Map<string, HuggingFaceEntry>()
let tiktokenModule: Promise<TiktokenModule> | undefined
let huggingFaceTokenizersModule: Promise<HuggingFaceTokenizersModule> | undefined
const inFlightTiktokenEncoders = new Map<string, Promise<TiktokenEntry>>()
const inFlightHuggingFaceTokenizers = new Map<string, Promise<HuggingFaceEntry>>()

export function resetTokenizerCachesForTest(): void {
  tiktokenCache.clear()
  huggingFaceTokenizerCache.clear()
  inFlightTiktokenEncoders.clear()
  inFlightHuggingFaceTokenizers.clear()
  tiktokenModule = undefined
  huggingFaceTokenizersModule = undefined
}

export class TokenizerManager {
  constructor(private warnings?: WarningCollector) {}

  async countTokens(content: string, model: TokenModel): Promise<number> {
    if (!content.trim()) return 0

    try {
      switch (model.spec.kind) {
        case "approx":
          return this.approximateTokenCount(content)
        case "tiktoken":
          return await this.countWithTiktoken(content, model.spec.model)
        case "huggingface":
          return await this.countWithHuggingFaceTokenizer(content, model.spec.hub)
      }
    } catch (error) {
      this.warnings?.add(
        `Token counting fell back to approximate mode for model '${model.name}': ${formatErrorMessage(error)}`,
        `token-count:${model.name}`
      )
      return this.approximateTokenCount(content)
    }
  }

  private approximateTokenCount(content: string): number {
    return Math.ceil(content.length / 4)
  }

  private async countWithTiktoken(content: string, model: string): Promise<number> {
    const encoder = await this.loadTiktokenEncoder(model)
    return encoder.encode(content).length
  }

  private async countWithHuggingFaceTokenizer(content: string, hub: string): Promise<number> {
    const tokenizer = await this.loadHuggingFaceTokenizer(hub)
    if (!tokenizer || typeof tokenizer.encode !== "function") {
      return this.approximateTokenCount(content)
    }

    try {
      const encoding = await tokenizer.encode(content)
      if (!Array.isArray(encoding?.ids)) {
        throw new Error(`Tokenizer '${hub}' returned no token IDs`)
      }
      return encoding.ids.length
    } catch (error) {
      throw new Error(`Tokenizer '${hub}' could not encode content: ${formatErrorMessage(error)}`)
    }
  }

  // Warnings are stored with cached entries because the collector belongs to the manager.
  // A shared cache entry must still warn every manager that consumes it.
  private warnForCacheEntry(entry: TiktokenEntry | HuggingFaceEntry): void {
    if (entry.warning) {
      this.warnings?.add(entry.warning, entry.warningKey)
    }
  }

  private async loadTiktokenEncoder(model: string) {
    let entry = tiktokenCache.get(model)
    if (!entry) {
      const pending = inFlightTiktokenEncoders.get(model)
      if (pending) {
        entry = await pending
      } else {
        const load = this.createTiktokenEntry(model)
        inFlightTiktokenEncoders.set(model, load)
        try {
          entry = await load
        } finally {
          inFlightTiktokenEncoders.delete(model)
        }
      }
    }

    this.warnForCacheEntry(entry)
    return entry.encoder
  }

  private async createTiktokenEntry(model: string): Promise<TiktokenEntry> {
    const mod = await this.loadTiktokenModule()
    const encodingForModel = mod.encodingForModel ?? mod.default?.encodingForModel
    const getEncoding = mod.getEncoding ?? mod.default?.getEncoding

    if (typeof getEncoding !== "function") {
      throw new Error("js-tiktoken did not expose getEncoding")
    }

    let encoder: TiktokenEncoder
    let warning: string | undefined
    let warningKey: string | undefined
    try {
      encoder = typeof encodingForModel === "function" ? encodingForModel(model) : getEncoding(model)
    } catch {
      warning = `Tiktoken does not recognize model '${model}'. Local content estimates use the cl100k_base encoding instead.`
      warningKey = `tiktoken-model:${model}`
      encoder = getEncoding("cl100k_base")
    }

    const entry = { encoder, warning, warningKey }
    tiktokenCache.set(model, entry)
    return entry
  }

  private async loadTiktokenModule(): Promise<TiktokenModule> {
    if (!tiktokenModule) {
      tiktokenModule = this.importRuntimePackage("js-tiktoken") as Promise<TiktokenModule>
    }
    return tiktokenModule
  }

  private async loadHuggingFaceTokenizer(hub: string) {
    let entry = huggingFaceTokenizerCache.get(hub)
    if (!entry) {
      const pending = inFlightHuggingFaceTokenizers.get(hub)
      if (pending) {
        entry = await pending
      } else {
        const load = this.createHuggingFaceEntry(hub)
        inFlightHuggingFaceTokenizers.set(hub, load)
        try {
          entry = await load
        } finally {
          inFlightHuggingFaceTokenizers.delete(hub)
        }
      }
    }

    this.warnForCacheEntry(entry)
    return entry.tokenizer
  }

  private async createHuggingFaceEntry(hub: string): Promise<HuggingFaceEntry> {
    if (APPROXIMATE_ONLY_HUGGINGFACE_HUBS.has(hub)) {
      const entry: HuggingFaceEntry = {
        tokenizer: null,
        warning: `Tally used approximate token counting for '${hub}' because it only loads public tokenizers directly in analysis mode.`,
        warningKey: `huggingface-tokenizer-approx-only:${hub}`,
      }
      huggingFaceTokenizerCache.set(hub, entry)
      return entry
    }

    try {
      const { Tokenizer } = await this.loadHuggingFaceTokenizersModule()
      const [tokenizerJson, tokenizerConfig] = await Promise.all([
        this.fetchHuggingFaceJson(hub, "tokenizer.json"),
        this.fetchHuggingFaceJson(hub, "tokenizer_config.json", true),
      ])
      const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig ?? {})
      const entry: HuggingFaceEntry = { tokenizer }
      huggingFaceTokenizerCache.set(hub, entry)
      return entry
    } catch (error) {
      const entry: HuggingFaceEntry = {
        tokenizer: null,
        warning: this.buildHuggingFaceFallbackWarning(hub, error),
        warningKey: `huggingface-tokenizer-load:${hub}`,
      }
      huggingFaceTokenizerCache.set(hub, entry)
      return entry
    }
  }

  private async loadHuggingFaceTokenizersModule(): Promise<HuggingFaceTokenizersModule> {
    if (!huggingFaceTokenizersModule) {
      huggingFaceTokenizersModule = this.importRuntimePackage("@huggingface/tokenizers") as Promise<HuggingFaceTokenizersModule>
    }
    return huggingFaceTokenizersModule
  }

  private async fetchHuggingFaceJson(hub: string, file: string, optional = false) {
    const response = await fetch(`https://huggingface.co/${hub}/raw/main/${file}`, {
      headers: this.getHuggingFaceHeaders(),
    })

    if (!response.ok) {
      if (optional && response.status === 404) {
        return null
      }

      throw new Error(`Failed to fetch ${file} for '${hub}' (HTTP ${response.status})`)
    }

    return response.json()
  }

  private getHuggingFaceHeaders() {
    const token = process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN ?? process.env.HUGGINGFACE_TOKEN
    return token ? { Authorization: `Bearer ${token}` } : undefined
  }

  private buildHuggingFaceFallbackWarning(hub: string, error: unknown) {
    const message = formatErrorMessage(error)
    if (message.includes("Token analyzer dependency '@huggingface/tokenizers' could not be loaded")) {
      return `Tally used approximate token counting for '${hub}' because the lightweight tokenizer runtime was unavailable.`
    }

    return `Tally used approximate token counting for '${hub}' because an exact public tokenizer could not be loaded.`
  }

  private async importRuntimePackage(pkg: string) {
    try {
      return await import(pkg)
    } catch (error) {
      throw new Error(
        `Token analyzer dependency '${pkg}' could not be loaded. ` +
          `Reinstall it with \`opencode plugin add opencode-tally\`. ${formatErrorMessage(error)}`
      )
    }
  }
}
