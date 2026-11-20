import { expect, test } from "bun:test"

import {
  PROVIDER_ORDER,
  PROVIDER_REGISTRY,
  isProviderID,
  pluginProviderForOpenCode,
} from "../../src/lib/quota/registry.js"
import type { UsageWindowKind } from "../../src/lib/quota/types.js"

const WINDOW_KINDS: readonly UsageWindowKind[] = [
  "rolling",
  "daily",
  "weekly",
  "monthly",
  "credits",
  "other",
]

test("PROVIDER_ORDER is the registered providers sorted by reference display order", () => {
  const definitions = Object.values(PROVIDER_REGISTRY)
  const expected = definitions
    .slice()
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((definition) => definition.id)

  expect(PROVIDER_ORDER).toEqual(expected)
  expect(new Set(PROVIDER_ORDER).size).toBe(PROVIDER_ORDER.length)
  expect(PROVIDER_ORDER).toHaveLength(14)
  expect(PROVIDER_ORDER).toContain("claude-code")
  expect(PROVIDER_ORDER).toHaveLength(Object.keys(PROVIDER_REGISTRY).length)
  expect(PROVIDER_ORDER).toContain("opencode-go")
  expect(PROVIDER_ORDER).toContain("codex")
  expect(PROVIDER_ORDER).toContain("qwen")
  expect(PROVIDER_ORDER).toContain("alibaba-token-plan")
  expect(PROVIDER_ORDER).toContain("commandcode")
})

test("every registered definition carries complete metadata", () => {
  for (const [key, definition] of Object.entries(PROVIDER_REGISTRY)) {
    expect(definition.id).toBe(key)
    expect(definition.defaultLabel.length).toBeGreaterThan(0)
    expect(Number.isInteger(definition.displayOrder)).toBe(true)
    expect(definition.displayOrder).toBeGreaterThanOrEqual(0)
    expect(WINDOW_KINDS).toContain(definition.footerWindowKind)
    expect(definition.openCodeProviderIDs.length).toBeGreaterThan(0)
    for (const id of definition.openCodeProviderIDs) expect(typeof id).toBe("string")
    expect(typeof definition.fetch).toBe("function")
  }
})

test("isProviderID accepts only registered ids", () => {
  for (const id of Object.keys(PROVIDER_REGISTRY)) expect(isProviderID(id)).toBe(true)
  expect(isProviderID("definitely-not-a-provider")).toBe(false)
  expect(isProviderID("")).toBe(false)
})

test("pluginProviderForOpenCode maps declared OpenCode ids and rejects unknown ones", () => {
  for (const definition of Object.values(PROVIDER_REGISTRY)) {
    for (const openCodeID of definition.openCodeProviderIDs) {
      expect(pluginProviderForOpenCode(openCodeID)).toBe(definition.id)
    }
  }
  expect(pluginProviderForOpenCode("definitely-not-an-opencode-provider")).toBeNull()
})
