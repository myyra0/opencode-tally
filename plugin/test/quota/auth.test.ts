import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  expandHome,
  loadOpenCodeAuth,
  officialOrigin,
  pickCredential,
  readAuthFileCredential,
  resolveCredential,
} from "../../src/lib/quota/auth.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

async function writeTempAuth(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tally-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, contents)
  return authPath
}

test("expandHome expands a leading tilde using the user home", () => {
  expect(expandHome("~/.config/opencode/auth.json")).toBe(
    `${os.homedir()}/.config/opencode/auth.json`
  )
})

test("resolveCredential resolves env references and literal values", () => {
  const previous = process.env.OPENCODE_API_KEY
  process.env.OPENCODE_API_KEY = "  env-key  "

  try {
    expect(resolveCredential("{env:OPENCODE_API_KEY}")).toBe("env-key")
    expect(resolveCredential("literal")).toBe("literal")
    expect(resolveCredential("  ")).toBeUndefined()
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCODE_API_KEY
    } else {
      process.env.OPENCODE_API_KEY = previous
    }
  }
})

test("resolveCredential trims surrounding whitespace", () => {
  expect(resolveCredential("  key  ")).toBe("key")
})

test("pickCredential only uses discovered credentials for official origins", () => {
  expect(pickCredential({ official: true, discovered: "d", configured: "c" })).toBe("d")
  expect(pickCredential({ official: false, discovered: "d" })).toBeUndefined()
  expect(pickCredential({ official: false, configured: "c" })).toBe("c")
})

test("officialOrigin compares the hostname exactly", () => {
  expect(officialOrigin("https://api.openai.com/v1", "api.openai.com")).toBe(true)
  expect(officialOrigin("https://api.openai.com.evil.test/v1", "api.openai.com")).toBe(false)
  expect(officialOrigin("not a url", "api.openai.com")).toBe(false)
})

test("loadOpenCodeAuth reads a provider entry from a temp auth file", async () => {
  const authPath = await writeTempAuth(
    JSON.stringify({ "opencode-go": { key: "k" } })
  )

  const { auth, diagnostic } = await loadOpenCodeAuth(authPath)

  expect(auth["opencode-go"]?.key).toBe("k")
  expect(diagnostic).toBeUndefined()
})

test("loadOpenCodeAuth reports malformed auth as a diagnostic without throwing", async () => {
  const authPath = await writeTempAuth("{not json")

  const result = await loadOpenCodeAuth(authPath)

  expect(result.auth).toEqual({})
  expect(typeof result.diagnostic).toBe("string")
})

test("loadOpenCodeAuth keeps valid entries when an earlier entry is malformed", async () => {
  const authPath = await writeTempAuth(
    JSON.stringify({ openai: 42, "opencode-go": { key: "kept" } })
  )

  const { auth, diagnostic } = await loadOpenCodeAuth(authPath)

  expect(auth["opencode-go"]?.key).toBe("kept")
  expect(typeof diagnostic).toBe("string")
})

test("readAuthFileCredential supports nested keys and provider-specific extractors", async () => {
  const authPath = await writeTempAuth(
    JSON.stringify({
      deepseek: { apiKey: "nested-key" },
      codex: { tokens: { access_token: "codex-token" } },
    })
  )

  expect(await readAuthFileCredential(authPath, "deepseek")).toBe("nested-key")
  expect(await readAuthFileCredential(authPath, "opencode-go")).toBeUndefined()
  expect(await readAuthFileCredential(undefined, "deepseek")).toBeUndefined()
  expect(
    await readAuthFileCredential(authPath, "codex", (value) => {
      const codex = value.codex
      if (typeof codex !== "object" || codex === null) {
        return undefined
      }
      const tokens = (codex as Record<string, unknown>).tokens
      if (typeof tokens !== "object" || tokens === null) {
        return undefined
      }
      const token = (tokens as Record<string, unknown>).access_token
      return typeof token === "string" ? token : undefined
    })
  ).toBe("codex-token")
})
