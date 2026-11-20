import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchOpenCodeGoUsage } from "../../../src/lib/quota/providers/opencode-go.js"

import { installFetchMock } from "./helpers.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

async function tempAuthPath(contents?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-go-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  if (contents !== undefined) await writeFile(authPath, contents)
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

test("uses the configured auth file or falls back to OpenCode auth", async () => {
  const cases = [
    ["valid", JSON.stringify({ "opencode-go": { key: "file-key" } }), "file-key"],
    ["missing", undefined, "auth-key"],
    ["malformed", "{", "auth-key"],
  ] as const

  for (const [_kind, contents, expectedKey] of cases) {
    const authPath = await tempAuthPath(contents)
    const fetchMock = installFetchMock(
      Response.json({ usage: { rolling: { percent: 1 } } })
    )

    await fetchOpenCodeGoUsage(
      { authPath },
      { "opencode-go": { key: "auth-key" } },
      1000
    )

    expect(fetchMock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: `Bearer ${expectedKey}` },
    })
  }
})

test("builds authenticated requests and parses usage windows", async () => {
  const fetchMock = installFetchMock(
    Response.json({
      usage: {
        monthly: { percent: 35, resetsAt: "2026-09-01T00:00:00.000Z" },
        rolling: { percent: 12, resetsAt: "2026-08-23T00:00:00.000Z" },
        weekly: { percent: 8, resetsAt: "2026-08-30T00:00:00.000Z" },
      },
    })
  )

  const before = Date.now()
  const usage = await fetchOpenCodeGoUsage(
    undefined,
    { "opencode-go": { key: "go-token" } },
    1000
  )
  const after = Date.now()

  expect(fetchMock.calls[0]?.[0]).toBe("https://opencode.ai/zen/go/v1/usage")
  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer go-token" },
    method: "GET",
  })
  expect(usage).toMatchObject({ id: "opencode-go", label: "OpenCode GO" })
  expect(usage.capturedAt).toBeGreaterThanOrEqual(before)
  expect(usage.capturedAt).toBeLessThanOrEqual(after)
  expect(usage.windows).toMatchObject([
    {
      kind: "rolling",
      label: "rolling",
      quota: { usedPercent: 12 },
      resetsAt: Date.parse("2026-08-23T00:00:00.000Z"),
    },
    {
      kind: "weekly",
      label: "weekly",
      quota: { usedPercent: 8 },
      resetsAt: Date.parse("2026-08-30T00:00:00.000Z"),
    },
    {
      kind: "monthly",
      label: "monthly",
      quota: { usedPercent: 35 },
      resetsAt: Date.parse("2026-09-01T00:00:00.000Z"),
    },
  ])
})

test("supports the OPENCODE_API_KEY environment reference", async () => {
  const fetchMock = installFetchMock(
    Response.json({ usage: { rolling: { percent: 1 } } })
  )

  const previous = process.env.OPENCODE_API_KEY
  process.env.OPENCODE_API_KEY = "env-token"

  try {
    await fetchOpenCodeGoUsage(
      { apiKey: "{env:OPENCODE_API_KEY}" },
      {},
      1000
    )
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCODE_API_KEY
    } else {
      process.env.OPENCODE_API_KEY = previous
    }
  }

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer env-token" },
  })
})

test("uses nested OpenCode auth credentials", async () => {
  const fetchMock = installFetchMock(
    Response.json({ usage: { rolling: { percent: 1 } } })
  )

  await fetchOpenCodeGoUsage(
    undefined,
    { opencode: { apiKey: "key" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer key" },
  })
})

test("parses only well-typed optional usage window fields", async () => {
  installFetchMock(
    Response.json({
      usage: {
        monthly: null,
        rolling: { percent: "invalid", resetsAt: 42 },
        weekly: { percent: 5, resetsAt: "not-a-date" },
      },
    })
  )

  const usage = await fetchOpenCodeGoUsage(
    { apiKey: "configured-key", baseUrl: "https://custom.example" },
    {},
    1000
  )

  expect(usage.windows).toMatchObject([
    { kind: "weekly", label: "weekly", quota: { usedPercent: 5 }, resetsAt: null },
  ])
})

test("rejects missing credentials", async () => {
  const error = await expectProviderError(fetchOpenCodeGoUsage(undefined, {}, 1000))

  expect(error.kind).toBe("missing_credentials")
  expect(error.providerID).toBe("opencode-go")
})

test("rejects malformed usage responses", async () => {
  installFetchMock(Response.json({ usage: { rolling: { percent: 101 } } }))

  const error = await expectProviderError(
    fetchOpenCodeGoUsage(undefined, { opencode: { key: "key" } }, 1000)
  )

  expect(error.kind).toBe("decode")
})

test("rejects malformed usage payloads", async () => {
  for (const response of [Response.json([]), Response.json({})]) {
    installFetchMock(response)

    const error = await expectProviderError(
      fetchOpenCodeGoUsage(undefined, { opencode: { key: "key" } }, 1000)
    )

    expect(error.kind).toBe("decode")
  }
})
