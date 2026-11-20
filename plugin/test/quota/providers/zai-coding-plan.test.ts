// ZAI Coding Plan adapter tests.

import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchZaiCodingPlanUsage } from "../../../src/lib/quota/providers/zai-coding-plan.js"
import type { OpenCodeAuth } from "../../../src/lib/quota/auth.js"

import { installFetchMock } from "./helpers.js"

const tempDirs: string[] = []
const ENV_KEY = "TALLY_ZAI_KEY"

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
  delete process.env[ENV_KEY]
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-zai-auth-"))
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

const limitsResponse = (limits: unknown) => Response.json({ data: { limits } })
const tokenLimit = { percentage: 50, type: "TOKENS_LIMIT", usage: 50 }

test("uses the configured auth file or falls back to OpenCode auth", async () => {
  const cases = [
    ["valid", JSON.stringify({ zai: { key: "file-key" } }), "file-key"],
    ["missing", undefined, "auth-key"],
    ["malformed", "{", "auth-key"],
  ] as const

  for (const [_kind, contents, expectedKey] of cases) {
    const authPath = path.join(
      tmpdir(),
      `tally-zai-${crypto.randomUUID()}.json`
    )
    if (contents !== undefined) await writeFile(authPath, contents)

    try {
      const fetchMock = installFetchMock(limitsResponse([tokenLimit]))
      await fetchZaiCodingPlanUsage(
        { authPath },
        { zai: { key: "auth-key" } },
        1000
      )
      expect(fetchMock.calls[0]?.[1]).toMatchObject({
        headers: { Authorization: expectedKey },
      })
    } finally {
      await rm(authPath, { force: true })
    }
  }
})

test("prefers auth data, sends bearer tokens when configured, and infers Max tier", async () => {
  const nextResetTime = Date.now() + 90_000
  const fetchMock = installFetchMock(
    limitsResponse([
      {
        currentValue: 4440,
        nextResetTime,
        percentage: 44.4,
        type: "TOKENS_LIMIT",
      },
      { currentValue: 25, percentage: 75, type: "TIME_LIMIT", usage: 1500 },
      { type: "UNKNOWN_LIMIT" },
    ])
  )

  const usage = await fetchZaiCodingPlanUsage(
    { apiKey: "config-key", authorizationScheme: "bearer", label: "Zed" },
    { zai: { key: "auth-key" } },
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://api.z.ai/api/monitor/usage/quota/limit",
    {
      headers: { Authorization: "Bearer auth-key" },
      method: "GET",
    },
  ])
  expect(usage).toMatchObject({
    id: "zai",
    label: "Zed",
    tierName: "Max",
  })
  expect(usage.windows).toMatchObject([
    {
      kind: "rolling",
      label: "5h",
      quota: {
        current: 4440,
        remainingPercent: 55.6,
        total: 10_000,
        usedPercent: 44.4,
      },
    },
  ])
  expect(usage.windows[0]?.resetsAt).toBe(nextResetTime)
})

test("sends raw keys by default", async () => {
  const fetchMock = installFetchMock(limitsResponse([tokenLimit]))

  await fetchZaiCodingPlanUsage({ apiKey: "raw-key" }, {}, 1000)

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "raw-key" },
  })
})

test("uses configured environment references when auth does not contain a key", async () => {
  process.env[ENV_KEY] = "env-key"
  const fetchMock = installFetchMock(limitsResponse([tokenLimit]))

  await fetchZaiCodingPlanUsage(
    { apiKey: `{env:${ENV_KEY}}` },
    {},
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "env-key" },
  })
})

test("ignores malformed optional fields while retaining valid token limits", async () => {
  installFetchMock(
    limitsResponse([
      { percentage: 50, type: 42, usage: 10 },
      { percentage: 50, type: "TOKENS_LIMIT", usage: "invalid" },
    ])
  )

  const usage = await fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: 50 })
  expect(usage.tierName).toBeUndefined()
})

test("accepts direct and nested OpenCode auth shapes", async () => {
  const cases: readonly (readonly [string, OpenCodeAuth, string])[] = [
    ["direct key", { key: "direct-key" }, "direct-key"],
    ["direct apiKey", { apiKey: "direct-key" }, "direct-key"],
    ["zai-coding-plan", { "zai-coding-plan": { key: "plan-key" } }, "plan-key"],
    ["zai", { zai: { key: "zai-key" } }, "zai-key"],
  ]

  for (const [_name, openCodeAuth, expectedKey] of cases) {
    const fetchMock = installFetchMock(limitsResponse([tokenLimit]))
    await fetchZaiCodingPlanUsage(undefined, openCodeAuth, 1000)
    expect(fetchMock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: expectedKey },
    })
  }
})

test("does not accept nested apiKey-only ZAI auth", async () => {
  installFetchMock(limitsResponse([tokenLimit]))
  const authCases: OpenCodeAuth[] = [
    { "zai-coding-plan": { apiKey: "nested-api-key" } },
    { zai: { apiKey: "nested-api-key" } },
  ]
  for (const openCodeAuth of authCases) {
    const error = await expectProviderError(
      fetchZaiCodingPlanUsage(undefined, openCodeAuth, 1000)
    )
    expect(error.kind).toBe("missing_credentials")
  }

  for (const contents of [
    JSON.stringify({ "zai-coding-plan": { apiKey: "file-api-key" } }),
    JSON.stringify({ zai: { apiKey: "file-api-key" } }),
  ]) {
    const authPath = await tempAuthPath(contents)
    const error = await expectProviderError(
      fetchZaiCodingPlanUsage({ authPath }, {}, 1000)
    )
    expect(error.kind).toBe("missing_credentials")
  }
})

test("infers plan tiers from the time-limit prompt total", async () => {
  const tiers = [
    [1400, "Max"],
    [1500, "Max"],
    [9999, "Max"],
    [300, "Pro"],
    [500, "Pro"],
    [1399, "Pro"],
    [1, "Lite"],
    [100, "Lite"],
    [299, "Lite"],
    [0, undefined],
  ] as const

  for (const [usageTotal, tierName] of tiers) {
    installFetchMock(
      limitsResponse([
        tokenLimit,
        { percentage: 1, type: "TIME_LIMIT", usage: usageTotal },
      ])
    )
    const usage = await fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)
    expect(usage.tierName).toBe(tierName)
  }

  installFetchMock(
    limitsResponse([tokenLimit, { percentage: 1, type: "TIME_LIMIT" }])
  )
  const missing = await fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)
  expect(missing.tierName).toBeUndefined()
})

test("rejects missing keys and malformed responses", async () => {
  const missing = await expectProviderError(
    fetchZaiCodingPlanUsage(undefined, {}, 1000)
  )
  expect(missing.kind).toBe("missing_credentials")
  expect(missing.providerID).toBe("zai")

  installFetchMock(Response.json({ data: {} }))
  const decode = await expectProviderError(
    fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)
  )
  expect(decode.kind).toBe("decode")
})

test("ignores null limits but rejects a payload without a rolling limit", async () => {
  installFetchMock(
    limitsResponse([null, { percentage: 50, type: "TIME_LIMIT", usage: 50 }])
  )

  const error = await expectProviderError(
    fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)
  )
  expect(error.kind).toBe("decode")
})

test("rejects invalid required token percentages", async () => {
  for (const percentage of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    installFetchMock(
      limitsResponse([{ percentage, type: "TOKENS_LIMIT" }])
    )
    const error = await expectProviderError(
      fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)
    )
    expect(error.kind).toBe("decode")
  }
})

test("downgrades invalid optional counts to percentage usage", async () => {
  installFetchMock(
    limitsResponse([
      { currentValue: -10, percentage: 25, type: "TOKENS_LIMIT" },
    ])
  )

  const usage = await fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)
  expect(usage.windows[0]?.quota._tag).toBe("Percentage")
  expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: 25 })
})

test("maps CREDIT_LIMIT windows with credit counts and the API plan level", async () => {
  const nextResetTime = Date.now() + 90_000
  installFetchMock(
    Response.json({
      data: {
        level: "max",
        limits: [
          {
            currentValue: 13423,
            nextResetTime,
            number: 5,
            percentage: 47,
            remaining: 14576,
            type: "CREDIT_LIMIT",
            unit: 3,
            usage: 28000,
          },
          {
            currentValue: 79992,
            nextResetTime: nextResetTime + 1,
            number: 1,
            percentage: 57,
            remaining: 60007,
            type: "CREDIT_LIMIT",
            unit: 6,
            usage: 140000,
          },
        ],
      },
    })
  )

  const usage = await fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.tierName).toBe("Max")
  expect(usage.windows).toMatchObject([
    {
      kind: "rolling",
      label: "5h",
      quota: { _tag: "Count", current: 13423, total: 28000, usedPercent: 47 },
      resetsAt: nextResetTime,
    },
    {
      kind: "weekly",
      label: "weekly",
      quota: { _tag: "Count", current: 79992, total: 140000, usedPercent: 57 },
      resetsAt: nextResetTime + 1,
    },
  ])
})

test("derives a credit percentage when the payload omits it", async () => {
  installFetchMock(
    limitsResponse([
      {
        currentValue: 250,
        number: 5,
        type: "CREDIT_LIMIT",
        unit: 3,
        usage: 1000,
      },
    ])
  )

  const usage = await fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.windows[0]?.quota).toMatchObject({
    _tag: "Count",
    current: 250,
    total: 1000,
    usedPercent: 25,
  })
})

test("keeps percentage-only CREDIT_LIMIT windows", async () => {
  installFetchMock(
    limitsResponse([
      { number: 5, percentage: 12, type: "CREDIT_LIMIT", unit: 3 },
    ])
  )

  const usage = await fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.windows[0]).toMatchObject({
    kind: "rolling",
    label: "5h",
    quota: { _tag: "Percentage", usedPercent: 12 },
  })
})
