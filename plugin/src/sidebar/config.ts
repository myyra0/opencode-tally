// TUI-side accessor for the sidebar section. Parsing lives in src/lib so both parts agree on defaults;
// this wrapper keeps the parser diagnostics for display.

import { loadSidebarConfig as load, DEFAULT_SIDEBAR_CONFIG } from "../lib/config.js"
import type { SidebarConfig } from "../lib/quota/types.js"

export { DEFAULT_SIDEBAR_CONFIG }

export function loadSidebarConfig(): Promise<{ value: SidebarConfig; diagnostics: string[] }> {
  return load()
}
