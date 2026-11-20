import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import plugin from "../src/index.ts"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("package.json routes only to the plugin module", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"))

  expect(pkg.main).toBe("./dist/index.js")
  expect(pkg.types).toBe("./dist/index.d.ts")
  expect(pkg.exports["."].import).toBe("./dist/index.js")
  expect(pkg.exports["."].types).toBe("./dist/index.d.ts")
  expect(pkg.exports["./server"]).toBeUndefined()
  expect(pkg.peerDependencies["@opencode-ai/plugin"]).toBeUndefined()
  expect(pkg.devDependencies["@opencode-ai/plugin"]).toBeUndefined()
})

// OpenCode's runtime JSX transform skips files under node_modules, so the published TUI part must
// be the compiled file. Its transform stays a separate build step.
test("package.json ships the TUI part compiled", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"))

  expect(pkg.exports["./tui"]).toBe("./dist/tui.js")
  expect(pkg.files.filter((file: string) => /\.tsx?$/.test(file))).toEqual([])
  expect(pkg.scripts.build).toBe("npm run clean && tsc")
  expect(pkg.scripts.prepublishOnly).toContain("build:tui")
})

// Each @opencode/plugin release requires the @opencode/theme of exactly its own version, so a
// floating SDK next to a pinned theme stops resolving as soon as OpenCode publishes a release.
test("the OpenCode V2 SDK and theme dev dependencies are pinned to the same version", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"))

  expect(pkg.devDependencies["@opencode/plugin"]).toMatch(/^\d+\.\d+\.\d+$/)
  expect(pkg.devDependencies["@opencode/theme"]).toBe(pkg.devDependencies["@opencode/plugin"])
})

test("the plugin module default-exports a plugin definition", () => {
  expect(Object.keys(plugin).sort()).toEqual(["id", "setup"])
  expect(plugin.id).toBe("tally")
  expect(typeof plugin.setup).toBe("function")
})
