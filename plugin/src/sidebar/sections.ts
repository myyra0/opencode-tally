// Canonical sidebar section order and the filter that turns a validated config into a render order.
// Unknown ids are ignored; if nothing valid is left, the defaults apply.

import { DEFAULT_SIDEBAR_CONFIG } from "../lib/config.js"
import type { SidebarConfig, SidebarSection } from "../lib/quota/types.js"

export function resolveSections(config: SidebarConfig): SidebarSection[] {
  const known = new Set<string>(DEFAULT_SIDEBAR_CONFIG.sections)
  const sections = Array.isArray(config?.sections) ? config.sections.filter((section) => known.has(section)) : []
  return sections.length > 0 ? sections : [...DEFAULT_SIDEBAR_CONFIG.sections]
}
