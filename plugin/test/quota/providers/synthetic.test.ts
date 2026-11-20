// Synthetic window adapter tests.

import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchSyntheticUsage } from "../../../src/lib/quota/providers/synthetic.js"
import type { OpenCodeAuth } from "../../../src/lib/quota/auth.js"

import { installFetchMock } from "./helpers.js"

const tempDirs: string[] = []
const ENV_KEY = "TALLY_SYNTHETIC_KEY"

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
  delete process.env[ENV_KEY]
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-synthetic-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, contents)
  return authPath
}

async function expectProviderError(
  promise: Promise<unknown>
): Promise<ProviderError> {
  try {
    await promise
    throw new Error("expected a ProviderError")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError)
    return error as ProviderError
  }
}

const nextTickAt = new Date(Date.now() + 90 * 60 * 1000).toISOString()
const nextRegenAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
const rollingOnly = { rollingFiveHourLimit: { max: 1, remaining: 1 } }

test("uses the configured auth file or falls back to OpenCode auth", async () => {
  const cases = [
    ["valid", JSON.stringify({ synthetic: { key: "file-key" } }), "file-key"],
    ["missing", undefined, "auth-key"],
    ["malformed", "{", "auth-key"],
  ] as const

  for (const [_kind, contents, expectedKey] of cases) {
    const authPath = path.join(
      tmpdir(),
      `tally-synthetic-${crypto.randomUUID()}.json`
    )
    if (contents !== undefined) await writeFile(authPath, contents)

    try {
      const fetchMock = installFetchMock(Response.json(rollingOnly))
      await fetchSyntheticUsage(
        { authPath },
        { synthetic: { key: "auth-key" } },
        1000
      )
      expect(fetchMock.calls[0]?.[1]).toMatchObject({
        headers: { Authorization: `Bearer ${expectedKey}` },
      })
    } finally {
      await rm(authPath, { force: true })
    }
  }
})

test("parses v3 rolling and weekly windows and sends a bearer header", async () => {
  const fetchMock = installFetchMock(
    Response.json({
      rollingFiveHourLimit: {
        limited: false,
        max: 100,
        nextTickAt,
        remaining: 40,
        tickPercent: 0.6,
      },
      weeklyTokenLimit: { nextRegenAt, percentRemaining: 75 },
    })
  )

  const usage = await fetchSyntheticUsage(
    { label: "Syn" },
    { synthetic: { key: "syn-test-key" } },
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://api.synthetic.new/v2/quotas",
    {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer syn-test-key",
      },
      method: "GET",
    },
  ])
  expect(usage).toMatchObject({ id: "synthetic", label: "Syn" })
  expect(usage.windows).toMatchObject([
    {
      kind: "rolling",
      label: "5h",
      quota: {
        current: 60,
        remainingPercent: 40,
        total: 100,
        usedPercent: 60,
      },
    },
    {
      kind: "weekly",
      label: "weekly",
      quota: { remainingPercent: 75, usedPercent: 25 },
    },
  ])
  expect(usage.windows[0]?.resetsAt).toBe(Date.parse(nextTickAt))
  expect(usage.windows[1]?.resetsAt).toBe(Date.parse(nextRegenAt))
  expect(usage.windows[0]?.resetsAt).toBeGreaterThan(Date.now())
})

test("accepts apiKey under the synthetic block in OpenCode auth", async () => {
  const fetchMock = installFetchMock(
    Response.json({ subscription: { limit: 1, requests: 0 } })
  )

  const usage = await fetchSyntheticUsage(
    {},
    { synthetic: { apiKey: "syn-apikey-test" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer syn-apikey-test" },
  })
  expect(usage.id).toBe("synthetic")
  expect(usage.windows).toHaveLength(1)
})

test("accepts direct and nested OpenCode auth shapes", async () => {
  const cases: readonly (readonly [string, OpenCodeAuth, string])[] = [
    ["direct key", { key: "direct-key" }, "direct-key"],
    ["direct apiKey", { apiKey: "direct-api-key" }, "direct-api-key"],
    ["nested key", { synthetic: { key: "nested-key" } }, "nested-key"],
    [
      "nested apiKey",
      { synthetic: { apiKey: "nested-api-key" } },
      "nested-api-key",
    ],
  ]

  for (const [_name, openCodeAuth, expectedKey] of cases) {
    const fetchMock = installFetchMock(Response.json(rollingOnly))
    await fetchSyntheticUsage(undefined, openCodeAuth, 1000)
    expect(fetchMock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: `Bearer ${expectedKey}` },
    })
  }
})

test("does not accept the opencode auth alias", async () => {
  installFetchMock(Response.json(rollingOnly))
  const authCases: OpenCodeAuth[] = [
    { opencode: { key: "opencode-key" } },
    { opencode: { apiKey: "opencode-api-key" } },
  ]
  for (const openCodeAuth of authCases) {
    const error = await expectProviderError(
      fetchSyntheticUsage(undefined, openCodeAuth, 1000)
    )
    expect(error.kind).toBe("missing_credentials")
  }

  for (const contents of [
    JSON.stringify({ opencode: { key: "file-opencode-key" } }),
    JSON.stringify({ opencode: { apiKey: "file-opencode-api-key" } }),
  ]) {
    const authPath = await tempAuthPath(contents)
    const error = await expectProviderError(
      fetchSyntheticUsage({ authPath }, {}, 1000)
    )
    expect(error.kind).toBe("missing_credentials")
  }
})

test("falls back to the legacy subscription bucket when v3 fields are missing", async () => {
  const renewsAt = new Date(Date.now() + 45 * 60 * 1000).toISOString()
  installFetchMock(
    Response.json({ subscription: { limit: 200, renewsAt, requests: 50 } })
  )

  const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)

  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]).toMatchObject({
    kind: "rolling",
    label: "5h",
    quota: {
      current: 50,
      remainingPercent: 75,
      total: 200,
      usedPercent: 25,
    },
  })
  expect(usage.windows[0]?.resetsAt).toBe(Date.parse(renewsAt))
})

test("prefers v3 rolling fields and keeps a valid weekly window", async () => {
  installFetchMock(
    Response.json({
      rollingFiveHourLimit: {
        limited: false,
        max: 200,
        nextTickAt,
        remaining: 100,
        tickPercent: 0.05,
      },
      subscription: { limit: 100, renewsAt: nextTickAt, requests: 50 },
      weeklyTokenLimit: { nextRegenAt, percentRemaining: 50 },
    })
  )

  const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)

  expect(usage.windows).toHaveLength(2)
  expect(usage.windows[0]).toMatchObject({
    label: "5h",
    quota: {
      current: 100,
      remainingPercent: 50,
      total: 200,
      usedPercent: 50,
    },
  })
  expect(usage.windows[0]?.resetsAt).toBe(Date.parse(nextTickAt))
  expect(usage.windows[1]).toMatchObject({
    label: "weekly",
    quota: { remainingPercent: 50, usedPercent: 50 },
  })
})

test("resolves environment references when no other credential is available", async () => {
  process.env[ENV_KEY] = "env-syn-key"
  const fetchMock = installFetchMock(
    Response.json({ rollingFiveHourLimit: { max: 50, remaining: 50 } })
  )

  const usage = await fetchSyntheticUsage(
    { apiKey: `{env:${ENV_KEY}}` },
    {},
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer env-syn-key" },
  })
  expect(usage.windows).toHaveLength(1)
})

test("rejects missing keys and malformed responses", async () => {
  const missing = await expectProviderError(
    fetchSyntheticUsage(undefined, {}, 1000)
  )
  expect(missing.kind).toBe("missing_credentials")
  expect(missing.providerID).toBe("synthetic")

  installFetchMock(Response.json([]))
  const array = await expectProviderError(
    fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
  )
  expect(array.kind).toBe("decode")

  installFetchMock(Response.json({}))
  const empty = await expectProviderError(
    fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
  )
  expect(empty.kind).toBe("decode")
})

test("ignores non-object quota buckets and malformed optional fields", async () => {
  installFetchMock(
    Response.json({
      rollingFiveHourLimit: [],
      subscription: [],
      weeklyTokenLimit: [],
    })
  )
  const nonObject = await expectProviderError(
    fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
  )
  expect(nonObject.kind).toBe("decode")

  installFetchMock(
    Response.json({
      rollingFiveHourLimit: {
        max: "invalid",
        nextTickAt: 42,
        remaining: "invalid",
      },
      subscription: { limit: "invalid", renewsAt: 42, requests: "invalid" },
      weeklyTokenLimit: { nextRegenAt: 42, percentRemaining: "invalid" },
    })
  )
  const malformed = await expectProviderError(
    fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
  )
  expect(malformed.kind).toBe("decode")
})

test("uses percentage quotas for fractional rolling counts", async () => {
  installFetchMock(
    Response.json({ rollingFiveHourLimit: { max: 2, remaining: 0.5 } })
  )

  const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
  expect(usage.windows[0]?.quota).toMatchObject({
    _tag: "Percentage",
    usedPercent: 75,
  })
})

test("rejects invalid required rolling counts", async () => {
  const cases = [
    { max: Number.POSITIVE_INFINITY, remaining: 10 },
    { max: 100, remaining: Number.NaN },
    { max: 100, remaining: -1 },
  ]

  for (const rollingFiveHourLimit of cases) {
    installFetchMock(Response.json({ rollingFiveHourLimit }))
    const error = await expectProviderError(
      fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
    )
    expect(error.kind).toBe("decode")
  }
})

test("omits an invalid weekly limit while retaining the rolling window", async () => {
  installFetchMock(
    Response.json({
      rollingFiveHourLimit: { max: 100, remaining: 50 },
      weeklyTokenLimit: { percentRemaining: 101 },
    })
  )

  const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]).toMatchObject({ label: "5h" })
})

test("rejects invalid legacy subscription limits", async () => {
  installFetchMock(
    Response.json({ subscription: { limit: 10, requests: 11 } })
  )
  const error = await expectProviderError(
    fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
  )
  expect(error.kind).toBe("decode")
})

test("emits the expected 5h and weekly window variants", async () => {
  const cases: readonly (readonly [
    string,
    Record<string, unknown>,
    readonly string[],
  ])[] = [
    [
      "rolling only",
      {
        rollingFiveHourLimit: { max: 100, remaining: 40, nextTickAt },
      },
      ["5h"],
    ],
    [
      "rolling and weekly",
      {
        rollingFiveHourLimit: { max: 100, remaining: 40, nextTickAt },
        weeklyTokenLimit: { nextRegenAt, percentRemaining: 75 },
      },
      ["5h", "weekly"],
    ],
    [
      "legacy only",
      { subscription: { limit: 200, renewsAt: nextTickAt, requests: 50 } },
      ["5h"],
    ],
    [
      "zero remaining",
      { rollingFiveHourLimit: { max: 100, remaining: 0 } },
      ["5h"],
    ],
  ]

  for (const [_name, payload, labels] of cases) {
    installFetchMock(Response.json(payload))
    const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
    expect(usage.windows.map((window) => window.label)).toStrictEqual([
      ...labels,
    ])
  }
})

test("does not use discovered OpenCode credentials for a custom host", async () => {
  const missing = await expectProviderError(
    fetchSyntheticUsage(
      { baseUrl: "https://synthetic.example.test" },
      { synthetic: { key: "discovered" } },
      1000
    )
  )
  expect(missing.kind).toBe("missing_credentials")

  const fetchMock = installFetchMock(Response.json(rollingOnly))
  await fetchSyntheticUsage(
    { apiKey: "explicit-key", baseUrl: "https://synthetic.example.test" },
    { synthetic: { key: "discovered" } },
    1000
  )
  expect(fetchMock.calls[0]).toMatchObject([
    "https://synthetic.example.test/v2/quotas",
    { headers: { Authorization: "Bearer explicit-key" } },
  ])
})

test("uses an explicitly configured authPath credential on a custom host", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ synthetic: { key: "auth-file-key" } })
  )
  const fetchMock = installFetchMock(Response.json(rollingOnly))

  await fetchSyntheticUsage(
    { authPath, baseUrl: "https://synthetic.example.test" },
    {},
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://synthetic.example.test/v2/quotas",
    { headers: { Authorization: "Bearer auth-file-key" } },
  ])
})

test("reads plan weekly credits and ignores the retired request counter", async () => {
  installFetchMock(
    Response.json({
      subscription: {
        limit: 500,
        renewsAt: "2026-11-01T09:33:15.773Z",
        requests: 0,
      },
      planWeeklyLimit: {
        nextRegenAt,
        nextRegenPercent: 2,
        percentRemaining: 99.6,
      },
    })
  )

  const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)

  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]).toMatchObject({
    kind: "weekly",
    label: "weekly",
    resetsAt: Date.parse(nextRegenAt),
  })
  expect(usage.windows[0]?.quota).toMatchObject({ remainingPercent: 99.6 })
  expect(usage.windows[0]?.quota.usedPercent).toBeCloseTo(0.4, 6)
})

test("accepts a weekly-only response without a five-hour window", async () => {
  installFetchMock(
    Response.json({ weeklyTokenLimit: { nextRegenAt, percentRemaining: 75 } })
  )

  const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)

  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]).toMatchObject({
    kind: "weekly",
    quota: { usedPercent: 25 },
  })
})

test("prefers plan weekly credits over the legacy weekly token limit", async () => {
  installFetchMock(
    Response.json({
      planWeeklyLimit: { nextRegenAt, percentRemaining: 90 },
      weeklyTokenLimit: { nextRegenAt, percentRemaining: 10 },
    })
  )

  const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)

  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: 10 })
})
