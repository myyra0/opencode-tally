import { expect, test } from "bun:test"

import { DEFAULT_SIDEBAR_CONFIG } from "../../src/lib/config.js"
import type { SidebarSection } from "../../src/lib/quota/types.js"
import { resolveSections } from "../../src/sidebar/sections.js"

test("uses the default section order when none is configured", () => {
  expect(resolveSections(DEFAULT_SIDEBAR_CONFIG)).toEqual(["quota", "context", "recorded", "contextWindow"])
})

test("honors a configured order, including a shorter list", () => {
  expect(resolveSections({ ...DEFAULT_SIDEBAR_CONFIG, sections: ["recorded", "quota"] })).toEqual(["recorded", "quota"])
})

test("ignores unknown ids and falls back to defaults when none remain", () => {
  const unknown = ["nope" as unknown as SidebarSection]
  expect(resolveSections({ ...DEFAULT_SIDEBAR_CONFIG, sections: unknown })).toEqual(DEFAULT_SIDEBAR_CONFIG.sections)
})
