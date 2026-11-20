import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { loadOpenCodeAuth, loadOpenCodeAuthWithIntegrations } from "../../src/lib/quota/auth.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeTempAuth(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tally-auth-int-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, contents)
  return authPath
}

function makeSource(listResult: any, activeMap: Record<string, any> = {}, resolveMap: Record<string, any> = {}) {
  return {
    list: async () => listResult,
    connection: {
      active: async (id: string) => activeMap[id],
      resolve: async (connection: any) => {
        if (connection && connection.id in resolveMap) return resolveMap[connection.id]
        return resolveMap[connection?.id ?? ""] ?? resolveMap.default
      },
    },
  } as any
}

test("key credential maps to auth[id].key and alias keys", async () => {
  const source = {
    list: async () => [{ id: "openai" }],
    connection: {
      active: async () => ({ type: "credential", id: "openai", label: "x", method: "key" }),
      resolve: async () => ({ type: "key", key: "secret-key" }),
    },
  }
  const { auth } = await loadOpenCodeAuthWithIntegrations(source)
  expect(auth.openai?.key).toBe("secret-key")
})

test("oauth credential maps fields and openai.accountId", async () => {
  const source = {
    list: async () => [{ id: "openai" }],
    connection: {
      active: async () => ({ type: "credential", id: "openai", label: "x", method: "oauth" }),
      resolve: async () => ({
        type: "oauth",
        methodID: "chatgpt-browser",
        access: "access-token",
        refresh: "refresh-token",
        expires: 123,
        metadata: { accountID: "acct-1" },
      }),
    },
  }
  const { auth } = await loadOpenCodeAuthWithIntegrations(source)
  expect(auth.openai?.access).toBe("access-token")
  expect(auth.openai?.key).toBe("access-token")
  expect(auth.openai?.refresh).toBe("refresh-token")
  expect(auth.openai?.expires).toBe(123)
  expect(auth.openai?.methodID).toBe("chatgpt-browser")
  expect(auth.openai?.accountId).toBe("acct-1")
})

test("external maps no secret but keeps methodID/metadata", async () => {
  const source = {
    list: async () => [{ id: "anthropic" }],
    connection: {
      active: async () => ({ type: "credential", id: "anthropic", label: "x", method: "external" }),
      resolve: async () => ({ type: "external", methodID: "ext", metadata: { foo: 1 } }),
    },
  }
  const { auth } = await loadOpenCodeAuthWithIntegrations(source)
  expect(auth.anthropic?.key).toBeUndefined()
  expect(auth.anthropic?.methodID).toBe("ext")
  expect(auth.anthropic?.metadata).toEqual({ foo: 1 })
})

test("env, undefined, and unlisted ids are ignored", async () => {
  const source = {
    list: async () => [{ id: "openai" }, { id: "deepseek" }, { id: "not-listed" }],
    connection: {
      active: async (id: string) => {
        if (id === "deepseek") return { type: "env", name: "DEEPSEEK_API_KEY" }
        if (id === "openai") return undefined
        return { type: "credential", id, label: "x", method: "key" }
      },
      resolve: async () => ({ type: "key", key: "k" }),
    },
  }
  const { auth } = await loadOpenCodeAuthWithIntegrations(source)
  expect(auth.deepseek).toBeUndefined()
  expect(auth.openai).toBeUndefined()
  expect(auth["not-listed"]).toBeUndefined()
})

test("throwing list() falls back to loadOpenCodeAuth", async () => {
  const authPath = await writeTempAuth(JSON.stringify({ "opencode-go": { key: "kept" } }))
  const source = {
    list: async () => { throw new Error("boom") },
    connection: { active: async () => undefined, resolve: async () => undefined },
  }
  const { auth } = await loadOpenCodeAuthWithIntegrations(source, authPath)
  expect(auth["opencode-go"]?.key).toBe("kept")
})

test("no secret appears in diagnostic", async () => {
  const authPath = await writeTempAuth("{not json")
  const source = {
    list: async () => { throw new Error("boom-secret") },
    connection: { active: async () => undefined, resolve: async () => undefined },
  }
  const { diagnostic } = await loadOpenCodeAuthWithIntegrations(source, authPath)
  expect(typeof diagnostic).toBe("string")
  expect(diagnostic).not.toContain("boom-secret")
})

test("direct id wins over alias when both exist", async () => {
  const source = {
    list: async () => [{ id: "opencode" }, { id: "opencode-go" }],
    connection: {
      active: async (id: string) => ({ type: "credential", id, label: "x", method: "key" }),
      resolve: async (connection: any) => ({ type: "key", key: connection.id === "opencode-go" ? "go-key" : "opencode-key" }),
    },
  }
  const { auth } = await loadOpenCodeAuthWithIntegrations(source)
  expect(auth["opencode-go"]?.key).toBe("go-key")
  expect(auth.opencode?.key).toBe("opencode-key")
})

test("reads integration list when list() returns { data }", async () => {
  const source = {
    list: async () => ({ location: "x", data: [{ id: "openai" }] }),
    connection: {
      active: async () => ({ type: "credential", id: "openai", label: "x", method: "key" }),
      resolve: async () => ({ type: "key", key: "object-form-key" }),
    },
  }
  const { auth } = await loadOpenCodeAuthWithIntegrations(source)
  expect(auth.openai?.key).toBe("object-form-key")
})

test("openai oauth without methodID is not exposed", async () => {
  const source = {
    list: async () => ({ data: [{ id: "openai" }] }),
    connection: {
      active: async () => ({ type: "credential", id: "openai", label: "x", method: "oauth" }),
      resolve: async () => ({ type: "oauth", access: "access-token", metadata: { accountID: "acct" } }),
    },
  }
  const { auth } = await loadOpenCodeAuthWithIntegrations(source)
  expect(auth.openai).toBeUndefined()
})