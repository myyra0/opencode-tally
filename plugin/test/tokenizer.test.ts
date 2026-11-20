import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import type { TokenModel } from "../src/lib/types.js"
import { TokenizerManager, resetTokenizerCachesForTest } from "../src/lib/tokenizer.js"
import { WarningCollector } from "../src/lib/warnings.js"

const originalFetch = globalThis.fetch

const hfModel: TokenModel = {
  name: "fake-hf-model",
  spec: { kind: "huggingface", hub: "fake/model" },
}

let fetchCalls: string[] = []

beforeEach(() => {
  resetTokenizerCachesForTest()
  fetchCalls = []
  globalThis.fetch = (async (url: string | URL | Request) => {
    fetchCalls.push(String(url))
    return new Response("{}", { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  resetTokenizerCachesForTest()
})

describe("TokenizerManager module-level caches", () => {
  it("shares a failed Hugging Face load across sequential managers", async () => {
    const first = new TokenizerManager(new WarningCollector())
    const second = new TokenizerManager(new WarningCollector())

    const firstCount = await first.countTokens("hello", hfModel)
    const fetchesAfterFirst = fetchCalls.length
    expect(fetchesAfterFirst).toBeGreaterThan(0) // HF loads tokenizer.json + tokenizer_config.json

    const secondCount = await second.countTokens("hello", hfModel)
    expect(fetchCalls).toHaveLength(fetchesAfterFirst)
    expect(secondCount).toBe(firstCount)
  })

  it("deduplicates concurrent Hugging Face loads", async () => {
    const first = new TokenizerManager(new WarningCollector())
    const second = new TokenizerManager(new WarningCollector())

    const [firstCount, secondCount] = await Promise.all([
      first.countTokens("hello", hfModel),
      second.countTokens("hello", hfModel),
    ])

    expect(fetchCalls).toHaveLength(2) // one load's two files, not two loads' four
    expect(secondCount).toBe(firstCount)
  })

  it("adds a fallback warning for every manager that reuses a cached failure", async () => {
    const firstWarnings = new WarningCollector()
    const secondWarnings = new WarningCollector()

    await new TokenizerManager(firstWarnings).countTokens("hello", hfModel)
    const fetchesAfterFirst = fetchCalls.length
    await new TokenizerManager(secondWarnings).countTokens("hello", hfModel)

    expect(fetchCalls).toHaveLength(fetchesAfterFirst)
    expect(firstWarnings.list()).toHaveLength(1)
    expect(secondWarnings.list()).toHaveLength(1)
    expect(secondWarnings.list()[0]).toContain("approximate token counting")
  })
})
