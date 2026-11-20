import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { parseJsonc } from "../src/lib/jsonc.ts"

const testDir = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testDir, "..")
const repoRoot = path.resolve(pluginRoot, "..")

const EXAMPLE_PATH = path.join(repoRoot, "docs", "examples", "tally-config.jsonc")
const BUNDLED_PATH = path.join(pluginRoot, "tally-config.json")
const SCHEMA_PATH = path.join(pluginRoot, "tally-config.schema.json")

const SCHEMA_URL = "https://raw.githubusercontent.com/myyra0/opencode-tally/main/plugin/tally-config.schema.json"

test("the complete example parses and has every top-level key", async () => {
  const parsed = parseJsonc(await fs.readFile(EXAMPLE_PATH, "utf8")) as Record<string, unknown>

  expect(parsed.$schema).toBe(SCHEMA_URL)
  for (const key of [
    "enableContextBreakdown",
    "enableToolSchemaEstimation",
    "enableCacheEfficiency",
    "enableSubagentAnalysis",
    "enableDetailedSubagentCostBreakdown",
    "enableSkillAnalysis",
    "sidebar",
    "quota",
  ]) {
    expect(parsed).toHaveProperty(key)
  }
  expect(typeof parsed.sidebar).toBe("object")
  expect(typeof parsed.quota).toBe("object")
})

test("the example configures the opencode-go and codex providers", async () => {
  const parsed = parseJsonc(await fs.readFile(EXAMPLE_PATH, "utf8")) as {
    quota: { providers: Record<string, { enabled?: boolean }> }
  }
  const providers = parsed.quota.providers

  expect(Object.keys(providers).sort()).toEqual(["codex", "opencode-go"])
  expect(providers["opencode-go"].enabled).toBe(true)
  expect(providers.codex.enabled).toBe(true)
})

test("the bundled config has a schema URL and still parses as strict JSON", async () => {
  const parsed = JSON.parse(await fs.readFile(BUNDLED_PATH, "utf8")) as Record<string, unknown>

  expect(typeof parsed.$schema).toBe("string")
  expect(parsed.$schema).toBe(SCHEMA_URL)
  expect(parsed.enableSkillAnalysis).toBe(true)
})

test("the shipped schema is valid JSON and matches the runtime config shape", async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8")) as {
    additionalProperties: boolean
    properties: { quota: { $ref: string } }
    definitions: {
      sidebar: { additionalProperties: boolean }
      quota: {
        additionalProperties: boolean
        properties: { requestTimeoutMs: { type: string; minimum: number } }
      }
      providers: { additionalProperties: boolean; properties: Record<string, unknown> }
      providerConfig: { additionalProperties: boolean }
    }
  }

  expect(schema.properties.quota.$ref).toBe("#/definitions/quota")
  expect(schema.definitions.quota.properties.requestTimeoutMs.type).toBe("number")
  expect(schema.definitions.quota.properties.requestTimeoutMs.minimum).toBe(1000)
  expect(schema.additionalProperties).toBe(false)
  expect(schema.definitions.sidebar.additionalProperties).toBe(false)
  expect(schema.definitions.quota.additionalProperties).toBe(false)
  expect(schema.definitions.providers.additionalProperties).toBe(false)
  expect(schema.definitions.providerConfig.additionalProperties).toBe(false)
  expect(Object.keys(schema.definitions.providers.properties).sort()).toEqual([
    "alibaba-token-plan",
    "claude-code",
    "codex",
    "commandcode",
    "deepseek",
    "minimax",
    "moonshotai",
    "moonshotai-cn",
    "novita-ai",
    "opencode-go",
    "openrouter",
    "qwen",
    "synthetic",
    "zai",
  ])
})
