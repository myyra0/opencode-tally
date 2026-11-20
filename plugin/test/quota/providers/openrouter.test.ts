import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchOpenRouterUsage } from "../../../src/lib/quota/providers/openrouter.js"
import { pluginProviderForOpenCode } from "../../../src/lib/quota/registry.js"

import { installFetchMock } from "./helpers.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
  delete process.env.OPENROUTER_API_KEY
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-openrouter-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, contents)
  return authPath
}

interface KeyResponseData {
  readonly byok_usage?: number
  readonly effective_budget?: {
    readonly limit_usd?: number | null
    readonly remaining_usd?: number | null
    readonly reset_interval?: string | null
    readonly resets_at?: string | null
  }
  readonly include_byok_in_limit?: boolean
  readonly limit?: number | string | null
  readonly limit_remaining?: number | string | null
  readonly limit_reset?: string | null
  readonly rate_limit?: {
    readonly interval: string
    readonly requests: number
  }
  readonly usage?: number
}

const keyResponse = (data: KeyResponseData) => Response.json({ data })

async function expectProviderError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise
    throw new Error("expected a ProviderError")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError)
    return error as ProviderError
  }
}

test("maps reset cadence without inventing a reset", async () => {
  const cadences: readonly (readonly [string | null | undefined, string])[] = [
    ["daily", "daily"],
    ["weekly", "weekly"],
    ["monthly", "monthly"],
    [null, "credits"],
    [undefined, "credits"],
    ["unspecified", "credits"],
  ]

  for (const [cadence, kind] of cadences) {
    const fetchMock = installFetchMock(
      keyResponse({ limit: 100, limit_remaining: 74.5, limit_reset: cadence })
    )

    const usage = await fetchOpenRouterUsage(
      undefined,
      { openrouter: { key: "key" } },
      1000
    )

    expect(fetchMock.calls[0]).toMatchObject([
      "https://openrouter.ai/api/v1/key",
      {
        headers: { Accept: "application/json", Authorization: "Bearer key" },
        method: "GET",
      },
    ])
    expect(usage.windows).toStrictEqual([
      {
        kind,
        label: "spend",
        quota: {
          _tag: "Count",
          current: 25.5,
          remainingPercent: 74.5,
          total: 100,
          unit: "USD",
          usedPercent: 25.5,
        },
        resetsAt: null,
      },
    ])
  }
})

test("does not double-count BYOK usage", async () => {
  for (const includeByok of [false, true]) {
    const fetchMock = installFetchMock(
      keyResponse({
        byok_usage: 17.38,
        include_byok_in_limit: includeByok,
        limit: 100,
        limit_remaining: 74.5,
        limit_reset: "monthly",
        rate_limit: { interval: "1h", requests: 1000 },
        usage: 25.5,
      })
    )

    const usage = await fetchOpenRouterUsage(
      undefined,
      { openrouter: { key: "key" } },
      1000
    )

    expect(fetchMock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer key" },
    })
    expect(usage.windows[0]?.quota).toMatchObject({
      current: 25.5,
      total: 100,
    })
  }
})

test("supports zero and fully consumed spending limits", async () => {
  installFetchMock(keyResponse({ limit: 100, limit_remaining: 100 }))
  const unused = await fetchOpenRouterUsage({ apiKey: "explicit" }, {}, 1000)
  expect(unused.windows[0]?.quota).toMatchObject({
    current: 0,
    usedPercent: 0,
  })

  installFetchMock(keyResponse({ limit: 100, limit_remaining: 0 }))
  const spent = await fetchOpenRouterUsage({ apiKey: "explicit" }, {}, 1000)
  expect(spent.windows[0]?.quota).toMatchObject({
    current: 100,
    usedPercent: 100,
  })
})

test("clamps a remaining amount larger than the limit", async () => {
  installFetchMock(keyResponse({ limit: 100, limit_remaining: 120 }))

  const usage = await fetchOpenRouterUsage({ apiKey: "explicit" }, {}, 1000)

  expect(usage.windows[0]?.quota).toMatchObject({
    current: 0,
    remainingPercent: 100,
    usedPercent: 0,
  })
})

test("does not invent a quota for absent or zero limits", async () => {
  const cases: readonly (readonly [string, KeyResponseData])[] = [
    ["null limit", { limit: null, limit_remaining: null }],
    ["missing limit", { limit_remaining: 10 }],
    ["zero limit", { limit: 0, limit_remaining: 0 }],
    ["null remaining", { limit: 100, limit_remaining: null }],
  ]

  for (const [_label, data] of cases) {
    installFetchMock(keyResponse(data))

    const usage = await fetchOpenRouterUsage({ apiKey: "explicit" }, {}, 1000)

    expect(usage.windows[0]).toMatchObject({
      kind: "credits",
      label: "spend limit",
      quota: { _tag: "Unknown" },
      resetsAt: null,
    })
  }
})

test("treats a non-finite limit as an unknown spend limit", async () => {
  // A raw body is required: Response.json(Infinity) would serialize it as null.
  installFetchMock(
    new Response('{"data":{"limit":1e999,"limit_remaining":50}}', {
      headers: { "content-type": "application/json" },
    })
  )

  const usage = await fetchOpenRouterUsage({ apiKey: "explicit" }, {}, 1000)

  expect(usage.windows[0]).toMatchObject({
    kind: "credits",
    label: "spend limit",
    quota: { _tag: "Unknown" },
    resetsAt: null,
  })
})

test("rejects malformed limits", async () => {
  const cases: readonly (readonly [string, KeyResponseData])[] = [
    ["string limit", { limit: "100", limit_remaining: 50 }],
    ["negative limit", { limit: -1, limit_remaining: 0 }],
    ["negative remaining", { limit: 100, limit_remaining: -1 }],
    ["string remaining", { limit: 100, limit_remaining: "50" }],
  ]

  for (const [_label, data] of cases) {
    installFetchMock(keyResponse(data))

    const error = await expectProviderError(
      fetchOpenRouterUsage({ apiKey: "explicit" }, {}, 1000)
    )

    expect(error.kind).toBe("decode")
  }
})

test("uses explicit environment-backed credentials", async () => {
  process.env.OPENROUTER_API_KEY = "environment-key"
  const fetchMock = installFetchMock(
    keyResponse({ limit: 100, limit_remaining: 74.5, limit_reset: "monthly" })
  )

  await fetchOpenRouterUsage(
    { apiKey: "{env:OPENROUTER_API_KEY}" },
    {},
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer environment-key" },
  })
})

test("prefers authPath to OpenCode and configured credentials", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ openrouter: { key: "file-key" } })
  )
  const fetchMock = installFetchMock(
    keyResponse({
      limit: 100,
      limit_remaining: 74.5,
      limit_reset: "monthly",
    })
  )

  await fetchOpenRouterUsage(
    { apiKey: "config-key", authPath },
    { openrouter: { key: "opencode-key" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer file-key" },
  })
})

test("requires an explicit credential on custom origins", async () => {
  const missing = await expectProviderError(
    fetchOpenRouterUsage(
      { baseUrl: "https://router.example.test" },
      { openrouter: { key: "opencode-key" } },
      1000
    )
  )
  expect(missing.kind).toBe("missing_credentials")

  const fetchMock = installFetchMock(
    keyResponse({ limit: 100, limit_remaining: 74.5, limit_reset: "monthly" })
  )
  await fetchOpenRouterUsage(
    {
      apiKey: "explicit-key",
      baseUrl: "https://router.example.test/v1?tenant=one#fragment",
    },
    { openrouter: { key: "opencode-key" } },
    1000
  )
  expect(fetchMock.calls[0]).toMatchObject([
    "https://router.example.test/api/v1/key",
    { headers: { Authorization: "Bearer explicit-key" } },
  ])
})

test("uses an explicitly configured authPath credential on custom origins", async () => {
  const authPath = await tempAuthPath(JSON.stringify({ key: "auth-file-key" }))
  const fetchMock = installFetchMock(
    keyResponse({ limit: 100, limit_remaining: 74.5 })
  )

  await fetchOpenRouterUsage(
    { authPath, baseUrl: "https://router.example.test" },
    {},
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://router.example.test/api/v1/key",
    { headers: { Authorization: "Bearer auth-file-key" } },
  ])
})

test("classifies HTTP and malformed-envelope failures", async () => {
  const secret = "openrouter-secret-api-key"
  installFetchMock(Response.json({ message: secret }, { status: 401 }))
  const transport = await expectProviderError(
    fetchOpenRouterUsage({ apiKey: secret }, {}, 1000)
  )
  expect(transport.kind).toBe("transport")
  expect(transport.status).toBe(401)
  expect(transport.message).not.toContain(secret)
  expect(String(transport)).not.toContain(secret)

  installFetchMock(Response.json({ data: [] }))
  const decode = await expectProviderError(
    fetchOpenRouterUsage({ apiKey: "explicit" }, {}, 1000)
  )
  expect(decode.kind).toBe("decode")
})

test("maps OpenCode sessions to the OpenRouter provider", () => {
  expect(pluginProviderForOpenCode("openrouter")).toBe("openrouter")
})

test("prefers the binding effective budget and its reset instant", async () => {
  const resetsAt = "2026-11-23T00:00:00.000Z"
  installFetchMock(
    keyResponse({
      effective_budget: {
        limit_usd: 500,
        remaining_usd: 400,
        reset_interval: "weekly",
        resets_at: resetsAt,
      },
      limit: 1000,
      limit_remaining: 900,
      limit_reset: "monthly",
    })
  )

  const usage = await fetchOpenRouterUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.windows[0]).toMatchObject({
    kind: "weekly",
    label: "spend",
    quota: { _tag: "Count", current: 100, total: 500, usedPercent: 20 },
    resetsAt: Date.parse(resetsAt),
  })
})

test("falls back to the legacy key limit when the effective budget is empty", async () => {
  installFetchMock(
    keyResponse({
      effective_budget: { limit_usd: 0, remaining_usd: 0 },
      limit: 100,
      limit_remaining: 50,
      limit_reset: "monthly",
    })
  )

  const usage = await fetchOpenRouterUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.windows[0]).toMatchObject({
    kind: "monthly",
    quota: { current: 50, total: 100, usedPercent: 50 },
    resetsAt: null,
  })
})
