import { expect, test, beforeAll, afterAll } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_TALLY_CONFIG,
  loadModelPricing,
  loadQuotaConfig,
  loadSidebarConfig,
  loadTallyConfig,
  resolveBundledAssetPath,
} from "../src/lib/config.ts"

const testDir = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testDir, "..")
let fixtureDir: string

beforeAll(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "tally-config-"))
})

afterAll(async () => {
  await fs.rm(fixtureDir, { recursive: true, force: true })
})

async function fixture(name: string, contents: string): Promise<string> {
  const fixturePath = path.join(fixtureDir, name)
  await fs.writeFile(fixturePath, contents, "utf8")
  return fixturePath
}

test("resolves bundled assets from the source module layout", async () => {
  const moduleDir = path.join(pluginRoot, "src", "lib")
  const assetPath = await resolveBundledAssetPath("models.json", moduleDir)

  expect(assetPath).toBe(path.join(pluginRoot, "models.json"))
})

test("resolves bundled assets from the compiled dist module layout", async () => {
  const moduleDir = path.join(pluginRoot, "dist", "lib")
  const assetPath = await resolveBundledAssetPath("models.json", moduleDir)

  expect(assetPath).toBe(path.join(pluginRoot, "models.json"))
})

test("loads the bundled pricing catalog instead of the default fallback table", async () => {
  const pricing = await loadModelPricing()

  expect(Object.keys(pricing).length).toBeGreaterThan(100)
  expect(pricing.default).toBeUndefined()
})

test("bundled and in-code config defaults include detailed subagent breakdown flag", async () => {
  expect(DEFAULT_TALLY_CONFIG.enableDetailedSubagentCostBreakdown).toBe(false)

  const configPath = await resolveBundledAssetPath("tally-config.json", path.join(pluginRoot, "src", "lib"))
  const bundledConfig = JSON.parse(await fs.readFile(configPath, "utf8"))

  expect(bundledConfig.enableDetailedSubagentCostBreakdown).toBe(false)
})

test("JSONC comments and trailing commas preserve the analysis flags", async () => {
  const configPath = await fixture("flags.jsonc", `{
    // keep every flag from the bundled config
    "enableSkillAnalysis": true,
    "enableContextBreakdown": false, /* overridden */
  }`)

  const config = await loadTallyConfig({}, configPath)

  expect(config.enableSkillAnalysis).toBe(true)
  expect(config.enableContextBreakdown).toBe(false)
  expect(config.enableCacheEfficiency).toBe(true)
})

test("sidebar sections default to the four canonical ids", async () => {
  const configPath = await fixture("sidebar-default.jsonc", "{}")

  expect((await loadSidebarConfig(configPath)).value.sections).toEqual(["quota", "context", "recorded", "contextWindow"])
})

test("unknown sidebar section ids are dropped with a diagnostic", async () => {
  const configPath = await fixture("sidebar-unknown.jsonc", `{
    "sidebar": { "sections": ["quota", "nope"] }
  }`)

  const result = await loadSidebarConfig(configPath)

  expect(result.diagnostics.length).toBe(1)
  expect(result.value.sections).toEqual(["quota"])
})

test("no known sections falls back to the default preset", async () => {
  const configPath = await fixture("sidebar-empty.jsonc", `{
    "sidebar": { "sections": ["nope"] }
  }`)

  const result = await loadSidebarConfig(configPath)

  expect(result.value.sections).toEqual(["quota", "context", "recorded", "contextWindow"])
  expect(result.diagnostics.length).toBe(1)
})

test("out-of-range refreshSeconds is a diagnostic, not a clamp", async () => {
  const configPath = await fixture("sidebar-refresh5.jsonc", `{
    "sidebar": { "refreshSeconds": 5 }
  }`)

  const result = await loadSidebarConfig(configPath)

  expect(result.value.refreshSeconds).toBe(60)
  expect(result.diagnostics[0]).toContain(">= 15")
})

test("an invalid refreshSeconds retains the last valid value", async () => {
  const configPath = await fixture("sidebar-last-valid.jsonc", `{
    "sidebar": { "refreshSeconds": 30 }
  }`)

  expect((await loadSidebarConfig(configPath)).value.refreshSeconds).toBe(30)

  await fs.writeFile(configPath, `{
    "sidebar": { "refreshSeconds": 5 }
  }`, "utf8")

  const result = await loadSidebarConfig(configPath)
  expect(result.value.refreshSeconds).toBe(30)
  expect(result.diagnostics[0]).toContain(">= 15")
})

test("config parse diagnostics do not echo file content", async () => {
  const secret = "super-secret-token-xyz"
  const configPath = await fixture("invalid-secret.jsonc", `{ "apiKey": "${secret}" THIS IS NOT JSON }`)

  const result = await loadSidebarConfig(configPath)

  expect(result.diagnostics[0]).toContain("Could not parse")
  expect(result.diagnostics[0]).toContain(configPath)
  expect(result.diagnostics[0]).toContain("check the JSON syntax")
  expect(result.diagnostics.join("\n")).not.toContain(secret)
})

test("quota section defaults when the key is missing", async () => {
  const configPath = await fixture("quota-default.jsonc", "{}")

  expect((await loadQuotaConfig(configPath)).value).toMatchObject({
    enabled: true,
    refreshIntervalSeconds: 60,
    requestTimeoutMs: 10000,
    showErrors: true,
    providers: {},
  })
})

test("provider footer fields are accepted and ignored", async () => {
  const configPath = await fixture("quota-footer.jsonc", `{
    "quota": {
      "providers": {
        "codex": { "enabled": true, "showFooterBar": false, "footerWindow": "weekly" }
      }
    }
  }`)

  const result = await loadQuotaConfig(configPath)

  expect(result.diagnostics).toEqual([])
  expect(result.value.providers.codex).toMatchObject({ enabled: true })
})

test("invalid requestTimeoutMs is a diagnostic and retains the last valid value", async () => {
  const configPath = await fixture("quota-timeout.jsonc", `{
    "quota": { "requestTimeoutMs": 100 }
  }`)

  const result = await loadQuotaConfig(configPath)

  expect(result.value.requestTimeoutMs).toBe(10000)
  expect(result.diagnostics[0]).toContain(">= 1000")
})

test("malformed JSONC yields a diagnostic and defaults instead of throwing", async () => {
  const configPath = await fixture("broken.jsonc", `{
    "sidebar": { "sections": ["quota", ] // missing brace
  }`)

  const result = await loadSidebarConfig(configPath)

  expect(result.value.sections).toEqual(["quota", "context", "recorded", "contextWindow"])
  expect(result.diagnostics.length).toBeGreaterThan(0)
})

test("removing refreshSeconds reverts to the in-code default", async () => {
  const configPath = await fixture("sidebar-key-removed.jsonc", `{
    "sidebar": { "refreshSeconds": 30 }
  }`)

  expect((await loadSidebarConfig(configPath)).value.refreshSeconds).toBe(30)

  await fs.writeFile(configPath, `{ "sidebar": {} }`, "utf8")

  const result = await loadSidebarConfig(configPath)
  expect(result.value.refreshSeconds).toBe(60)
  expect(result.diagnostics).toEqual([])
})

test("removing sidebar fields reverts every absent key to its default", async () => {
  const configPath = await fixture("sidebar-all-removed.jsonc", `{
    "sidebar": {
      "enabled": false,
      "refreshSeconds": 30,
      "sections": ["recorded"],
      "showBars": false,
      "showPercentages": false,
      "showWarnings": false,
      "showUpdated": false
    }
  }`)

  expect((await loadSidebarConfig(configPath)).value).toMatchObject({
    enabled: false,
    refreshSeconds: 30,
    sections: ["recorded"],
    showBars: false,
    showPercentages: false,
    showWarnings: false,
    showUpdated: false,
  })

  await fs.writeFile(configPath, `{ "sidebar": {} }`, "utf8")

  const result = await loadSidebarConfig(configPath)
  expect(result.value).toMatchObject({
    enabled: true,
    refreshSeconds: 60,
    sections: ["quota", "context", "recorded", "contextWindow"],
    showBars: true,
    showPercentages: true,
    showWarnings: true,
    showUpdated: true,
  })
  expect(result.diagnostics).toEqual([])
})

test("removing quota numeric fields reverts to the in-code defaults", async () => {
  const configPath = await fixture("quota-numeric-removed.jsonc", `{
    "quota": { "refreshIntervalSeconds": 30, "requestTimeoutMs": 5000 }
  }`)

  expect((await loadQuotaConfig(configPath)).value).toMatchObject({
    refreshIntervalSeconds: 30,
    requestTimeoutMs: 5000,
  })

  await fs.writeFile(configPath, `{ "quota": {} }`, "utf8")

  const result = await loadQuotaConfig(configPath)
  expect(result.value).toMatchObject({ refreshIntervalSeconds: 60, requestTimeoutMs: 10000 })
  expect(result.diagnostics).toEqual([])
})

test("removing remaining quota fields reverts them to their defaults", async () => {
  const configPath = await fixture("quota-all-removed.jsonc", `{
    "quota": {
      "enabled": false,
      "refreshIntervalSeconds": 30,
      "requestTimeoutMs": 5000,
      "showErrors": false,
      "providers": { "codex": { "enabled": true } }
    }
  }`)

  expect((await loadQuotaConfig(configPath)).value).toMatchObject({
    enabled: false,
    showErrors: false,
    providers: { codex: { enabled: true } },
  })

  await fs.writeFile(configPath, `{ "quota": {} }`, "utf8")

  const result = await loadQuotaConfig(configPath)
  expect(result.value).toMatchObject({
    enabled: true,
    refreshIntervalSeconds: 60,
    requestTimeoutMs: 10000,
    showErrors: true,
    providers: {},
  })
  expect(result.diagnostics).toEqual([])
})

test("an invalid quota interval retains the last valid value", async () => {
  const configPath = await fixture("quota-last-valid.jsonc", `{
    "quota": { "refreshIntervalSeconds": 30 }
  }`)

  expect((await loadQuotaConfig(configPath)).value.refreshIntervalSeconds).toBe(30)

  await fs.writeFile(configPath, `{
    "quota": { "refreshIntervalSeconds": 5 }
  }`, "utf8")

  const result = await loadQuotaConfig(configPath)
  expect(result.value.refreshIntervalSeconds).toBe(30)
  expect(result.diagnostics[0]).toContain(">= 15")
})
