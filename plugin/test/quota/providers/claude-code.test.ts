import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchClaudeCodeUsage } from "../../../src/lib/quota/providers/claude-code.js"

import { installFetchMock, type FetchCall, type FetchMock } from "./helpers.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-claude-code-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, ".credentials.json")
  await writeFile(authPath, contents)
  return authPath
}

async function expectProviderError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise
    throw new Error("expected a ProviderError")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError)
    return error as ProviderError
  }
}

const HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: "Bearer file-token",
  "anthropic-beta": "oauth-2025-04-20",
  "anthropic-dangerous-direct-browser-access": "true",
  "User-Agent": "claude-code/2.1.0",
  "x-app": "cli",
}

test("reads ~/.claude/.credentials.json via authPath and sends exact URL + headers", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ claudeAiOauth: { accessToken: "file-token", expiresAt: Date.now() + 100000, subscriptionType: "pro" } })
  )
  const fetchMock = installFetchMock(
    Response.json({ five_hour: { utilization: 10, resets_at: "2026-01-01T00:00:00Z" } })
  )

  await fetchClaudeCodeUsage({ authPath }, {}, 1000)

  expect(fetchMock.calls[0]?.[0]).toBe("https://api.anthropic.com/api/oauth/usage")
  expect(fetchMock.calls[0]?.[1]).toMatchObject({ headers: HEADERS, method: "GET" })
})

test("prefers config.apiKey over the file", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ claudeAiOauth: { accessToken: "file-token", expiresAt: Date.now() + 100000 } })
  )
  const fetchMock = installFetchMock(
    Response.json({ five_hour: { utilization: 10, resets_at: null } })
  )

  await fetchClaudeCodeUsage({ apiKey: "config-token", authPath }, {}, 1000)

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer config-token" },
  })
})

test("uses auth.anthropic.access (sk-ant-oat...) when no file/key", async () => {
  const fetchMock = installFetchMock(
    Response.json({ five_hour: { utilization: 10, resets_at: null } })
  )

  await fetchClaudeCodeUsage(
    undefined,
    { anthropic: { access: "sk-ant-oat01-abc" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer sk-ant-oat01-abc" },
  })
})

test("macOS Keychain fallback through injected run", async () => {
  const run = async () => JSON.stringify({
    claudeAiOauth: { accessToken: "keychain-token", expiresAt: Date.now() + 100000 },
  })
  const fetchMock = installFetchMock(
    Response.json({ five_hour: { utilization: 10, resets_at: null } })
  )

  await fetchClaudeCodeUsage(undefined, {}, 1000, run as any, "darwin")

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer keychain-token" },
  })
})

test("legacy response maps to 5h, weekly, Opus, Sonnet windows", async () => {
  installFetchMock(
    Response.json({
      five_hour: { utilization: 54, resets_at: "2026-01-01T00:00:00Z" },
      seven_day: { utilization: 31, resets_at: "2026-01-02T00:00:00Z" },
      seven_day_opus: { utilization: 10, resets_at: null },
      seven_day_sonnet: { utilization: 20, resets_at: null },
    })
  )

  const usage = await fetchClaudeCodeUsage({ apiKey: "t" }, {}, 1000)

  expect(usage.windows.map((w) => w.label)).toEqual(["5h", "weekly", "Opus", "Sonnet"])
})

test("modern limits response maps session + scoped weekly labels; ignores legacy", async () => {
  installFetchMock(
    Response.json({
      five_hour: { utilization: 54, resets_at: "2026-01-01T00:00:00Z" },
      limits: [
        { kind: "session", percent: 27.5, resets_at: "2026-01-01T00:00:00Z" },
        { kind: "weekly_scoped", percent: 61.2, resets_at: "2026-01-02T00:00:00Z", scope: { model: { display_name: "Fable" } } },
      ],
    })
  )

  const usage = await fetchClaudeCodeUsage({ apiKey: "t" }, {}, 1000)

  expect(usage.windows.map((w) => w.label)).toEqual(["5h", "Fable"])
  expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: 27.5 })
})

test("extra_usage maps to USD credits window", async () => {
  installFetchMock(
    Response.json({
      five_hour: { utilization: 10, resets_at: null },
      extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 25, utilization: 25 },
    })
  )

  const usage = await fetchClaudeCodeUsage({ apiKey: "t" }, {}, 1000)

  expect(usage.windows.find((w) => w.kind === "credits")).toMatchObject({
    label: "extra usage",
    quota: { _tag: "Count", unit: "USD" },
  })
})

test("expired expiresAt throws missing_credentials", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ claudeAiOauth: { accessToken: "file-token", expiresAt: Date.now() - 1000 } })
  )

  const error = await expectProviderError(fetchClaudeCodeUsage({ authPath }, {}, 1000))
  expect(error.kind).toBe("missing_credentials")
  expect(error.message).toContain("expired")
})

test("401 throws missing_credentials; 429 stays rate_limit", async () => {
  installFetchMock(new Response(null, { status: 401 }))
  const e1 = await expectProviderError(fetchClaudeCodeUsage({ apiKey: "t" }, {}, 1000))
  expect(e1.kind).toBe("missing_credentials")

  installFetchMock(new Response(null, { status: 429 }))
  const e2 = await expectProviderError(fetchClaudeCodeUsage({ apiKey: "t" }, {}, 1000))
  expect(e2.kind).toBe("rate_limit")
})

test("empty/invalid payload throws decode", async () => {
  installFetchMock(Response.json([]))
  const e1 = await expectProviderError(fetchClaudeCodeUsage({ apiKey: "t" }, {}, 1000))
  expect(e1.kind).toBe("decode")

  installFetchMock(Response.json({}))
  const e2 = await expectProviderError(fetchClaudeCodeUsage({ apiKey: "t" }, {}, 1000))
  expect(e2.kind).toBe("decode")
})

test("missing file/key throws missing_credentials without path or token in message", async () => {
  const error = await expectProviderError(fetchClaudeCodeUsage(undefined, {}, 1000))
  expect(error.kind).toBe("missing_credentials")
  expect(error.message).not.toContain("/")
  expect(error.message).not.toContain("token")
})

test("openCode anthropic oauth with past expires throws without fetch", async () => {
  const fetchMock = installFetchMock(
    Response.json({ five_hour: { utilization: 10 } })
  )
  await expect(
    fetchClaudeCodeUsage(
      {},
      { anthropic: { access: "sk-ant-oat-expired", expires: Date.now() - 1000 } },
      1000
    )
  ).rejects.toMatchObject({ kind: "missing_credentials" })
  expect(fetchMock.calls).toHaveLength(0)
})
