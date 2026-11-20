// MiniMax Token Plan adapter tests.

import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchMiniMaxTokenPlanUsage } from "../../../src/lib/quota/providers/minimax.js"
import type { OpenCodeAuth } from "../../../src/lib/quota/auth.js"

import { installFetchMock } from "./helpers.js"

const tempDirs: string[] = []
const ENV_KEY = "TALLY_MINIMAX_KEY"

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
  delete process.env[ENV_KEY]
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-minimax-auth-"))
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

const fiveHourRemains = 90 * 60 * 1000
const weeklyRemains = 3 * 24 * 60 * 60 * 1000
const successEnvelope = <T>(modelRemains: T) => ({
  base_resp: { status_code: 0, status_msg: "success" },
  model_remains: modelRemains,
})
const generalEntry = (overrides: Record<string, unknown> = {}) => ({
  current_interval_remaining_percent: 80,
  current_interval_status: 1,
  model_name: "general",
  ...overrides,
})

test("uses the configured auth file or falls back to OpenCode auth", async () => {
  const cases = [
    ["valid", JSON.stringify({ minimax: { key: "file-key" } }), "file-key"],
    ["root key", JSON.stringify({ key: "file-key" }), "file-key"],
    ["root apiKey", JSON.stringify({ apiKey: "file-key" }), "file-key"],
    ["non-object", "null", "auth-key"],
    ["missing", undefined, "auth-key"],
    ["malformed", "{", "auth-key"],
  ] as const

  for (const [_kind, contents, expectedKey] of cases) {
    const authPath = path.join(
      tmpdir(),
      `tally-minimax-${crypto.randomUUID()}.json`
    )
    if (contents !== undefined) await writeFile(authPath, contents)

    try {
      const fetchMock = installFetchMock(
        Response.json(successEnvelope([generalEntry()]))
      )
      await fetchMiniMaxTokenPlanUsage(
        { authPath },
        { minimax: { key: "auth-key" } },
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

test("parses the general entry and reports both 5h and weekly windows", async () => {
  const fetchMock = installFetchMock(
    Response.json(
      successEnvelope([
        generalEntry({
          current_interval_remaining_percent: 99,
          current_weekly_remaining_percent: 99,
          model_name: "video",
          remains_time: fiveHourRemains,
          weekly_remains_time: weeklyRemains,
        }),
        generalEntry({
          current_interval_remaining_percent: 60,
          current_weekly_remaining_percent: 40,
          current_weekly_status: 1,
          remains_time: fiveHourRemains,
          weekly_remains_time: weeklyRemains,
        }),
      ])
    )
  )

  const usage = await fetchMiniMaxTokenPlanUsage(
    { apiKey: "mm-key", label: "MiniMax CN" },
    {},
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://www.minimax.io/v1/token_plan/remains",
    {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer mm-key",
        "Content-Type": "application/json",
      },
      method: "GET",
    },
  ])
  expect(usage).toMatchObject({ id: "minimax", label: "MiniMax CN" })
  expect(usage.windows).toMatchObject([
    {
      kind: "rolling",
      label: "5h",
      quota: { remainingPercent: 60, usedPercent: 40 },
    },
    {
      kind: "weekly",
      label: "weekly",
      quota: { remainingPercent: 40, usedPercent: 60 },
    },
  ])
  expect(usage.windows[0]?.resetsAt).toBeGreaterThan(
    Date.now() + fiveHourRemains - 5000
  )
  expect(usage.windows[1]?.resetsAt).toBeGreaterThan(
    Date.now() + weeklyRemains - 5000
  )
})

test("honours a baseUrl override for the China region", async () => {
  const fetchMock = installFetchMock(
    Response.json(successEnvelope([generalEntry()]))
  )

  await fetchMiniMaxTokenPlanUsage(
    { apiKey: "mm-key", baseUrl: "https://api.minimaxi.com" },
    {},
    1000
  )

  expect(fetchMock.calls[0]?.[0]).toBe(
    "https://api.minimaxi.com/v1/token_plan/remains"
  )
})

test("looks up the key under all supported OpenCode auth namespaces", async () => {
  const cases: readonly (readonly [string, OpenCodeAuth, string])[] = [
    ["direct key", { key: "direct-key" }, "direct-key"],
    ["direct apiKey", { apiKey: "direct-api-key" }, "direct-api-key"],
    ["minimax", { minimax: { apiKey: "nested-api-key" } }, "nested-api-key"],
    [
      "minimax-coding-plan",
      { "minimax-coding-plan": { apiKey: "nested-api-key" } },
      "nested-api-key",
    ],
    [
      "minimax-token-plan",
      { "minimax-token-plan": { key: "alias-mm-key" } },
      "alias-mm-key",
    ],
  ]

  for (const [_name, openCodeAuth, expectedKey] of cases) {
    const fetchMock = installFetchMock(
      Response.json(successEnvelope([generalEntry()]))
    )
    const usage = await fetchMiniMaxTokenPlanUsage(undefined, openCodeAuth, 1000)
    expect(fetchMock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: `Bearer ${expectedKey}` },
    })
    expect(usage.id).toBe("minimax")
  }
})

test("accepts the minimax-coding-plan provider id in OpenCode auth", async () => {
  const fetchMock = installFetchMock(
    Response.json(successEnvelope([generalEntry()]))
  )

  const usage = await fetchMiniMaxTokenPlanUsage(
    {},
    { "minimax-coding-plan": { key: "auth-mm-key" } },
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://www.minimax.io/v1/token_plan/remains",
    { headers: { Authorization: "Bearer auth-mm-key" } },
  ])
  expect(usage).toMatchObject({ id: "minimax" })
})

test("rejects missing auth layouts", async () => {
  const layouts: OpenCodeAuth[] = [
    { minimax: undefined },
    { "minimax-coding-plan": undefined },
    { "minimax-token-plan": undefined },
    {},
    { minimax: {} },
  ]

  for (const openCodeAuth of layouts) {
    const error = await expectProviderError(
      fetchMiniMaxTokenPlanUsage(undefined, openCodeAuth, 1000)
    )
    expect(error.kind).toBe("missing_credentials")
    expect(error.providerID).toBe("minimax")
  }
})

test("prefers openCodeAuth over the configured apiKey", async () => {
  const fetchMock = installFetchMock(
    Response.json(successEnvelope([generalEntry()]))
  )

  await fetchMiniMaxTokenPlanUsage(
    { apiKey: "config-mm-key" },
    { minimax: { apiKey: "auth-mm-key" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer auth-mm-key" },
  })
})

test("resolves environment references when no other credential is available", async () => {
  process.env[ENV_KEY] = "env-mm-key"
  const fetchMock = installFetchMock(
    Response.json(successEnvelope([generalEntry()]))
  )

  await fetchMiniMaxTokenPlanUsage(
    { apiKey: `{env:${ENV_KEY}}` },
    {},
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer env-mm-key" },
  })
})

test("emits only the window whose remaining percent is reported", async () => {
  installFetchMock(
    Response.json(successEnvelope([generalEntry({ remains_time: fiveHourRemains })]))
  )

  const usage = await fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)

  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]).toMatchObject({
    label: "5h",
    quota: { remainingPercent: 80, usedPercent: 20 },
  })
})

test("falls back to the first in-plan entry when no general entry exists", async () => {
  installFetchMock(
    Response.json(
      successEnvelope([
        generalEntry({
          current_interval_remaining_percent: 70,
          current_weekly_remaining_percent: 80,
          current_weekly_status: 1,
          model_name: "video",
          remains_time: fiveHourRemains,
          weekly_remains_time: weeklyRemains,
        }),
        { model_name: "image" },
      ])
    )
  )

  const usage = await fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)

  expect(usage.windows).toHaveLength(2)
  expect(usage.windows[0]).toMatchObject({
    label: "5h",
    quota: { remainingPercent: 70, usedPercent: 30 },
  })
  expect(usage.windows[1]).toMatchObject({
    label: "weekly",
    quota: { remainingPercent: 80, usedPercent: 20 },
  })
})

test("rejects malformed responses", async () => {
  installFetchMock(Response.json({}))
  const empty = await expectProviderError(
    fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  )
  expect(empty.kind).toBe("decode")

  installFetchMock(
    Response.json(successEnvelope([generalEntry({ current_interval_status: 3 })]))
  )
  const hidden = await expectProviderError(
    fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  )
  expect(hidden.kind).toBe("decode")

  installFetchMock(
    Response.json({ base_resp: successEnvelope([]).base_resp, model_remains: "x" })
  )
  const wrongType = await expectProviderError(
    fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  )
  expect(wrongType.kind).toBe("decode")
})

test("rejects payloads that are not wrapped in the model_remains envelope", async () => {
  installFetchMock(
    Response.json([generalEntry({ remains_time: fiveHourRemains })])
  )
  const error = await expectProviderError(
    fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  )
  expect(error.kind).toBe("decode")
})

test("ignores null model entries before selecting a usable entry", async () => {
  installFetchMock(
    Response.json(successEnvelope([null, generalEntry({ current_interval_status: 1 })]))
  )

  const usage = await fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  expect(usage.windows[0]).toMatchObject({
    label: "5h",
    quota: { remainingPercent: 80, usedPercent: 20 },
  })
})

test("rejects invalid remaining percentages", async () => {
  for (const current_interval_remaining_percent of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    installFetchMock(
      Response.json(
        successEnvelope([
          generalEntry({ current_interval_remaining_percent }),
        ])
      )
    )
    const error = await expectProviderError(
      fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
    )
    expect(error.kind).toBe("decode")
  }
})

test("rejects envelopes whose base_resp status is not successful", async () => {
  const cases = [
    { base_resp: { status_code: 1, status_msg: "some error" } },
    { base_resp: { status_code: 0, status_msg: 42 } },
    { base_resp: { status_code: 0 } },
    {},
  ]

  for (const extra of cases) {
    installFetchMock(
      Response.json({
        ...extra,
        model_remains: [generalEntry({ remains_time: fiveHourRemains })],
      })
    )
    const error = await expectProviderError(
      fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
    )
    expect(error.kind).toBe("decode")
  }
})

test("accepts successful base_resp with a null or absent status code", async () => {
  for (const base_resp of [
    { status_code: null, status_msg: "success" },
    { status_msg: "success" },
  ]) {
    installFetchMock(
      Response.json({ base_resp, model_remains: [generalEntry()] })
    )
    await expect(
      fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
    ).resolves.toMatchObject({ id: "minimax" })
  }
})

test("ignores invalid optional model fields without dropping valid windows", async () => {
  const cases: readonly (readonly [
    string,
    unknown,
    readonly string[],
    readonly string[],
  ])[] = [
    ["current_interval_status", "1", ["5h", "weekly"], []],
    ["current_weekly_remaining_percent", "70", ["5h"], []],
    ["current_weekly_status", "1", ["5h", "weekly"], []],
    ["model_name", 42, ["5h", "weekly"], []],
    ["remains_time", "1000", ["5h", "weekly"], ["5h"]],
    ["weekly_remains_time", "2000", ["5h", "weekly"], ["weekly"]],
  ]

  for (const [field, value, labels, nullResetLabels] of cases) {
    installFetchMock(
      Response.json(
        successEnvelope([
          generalEntry({
            current_weekly_remaining_percent: 70,
            current_weekly_status: 1,
            remains_time: 1000,
            weekly_remains_time: 2000,
            [field]: value,
          }),
        ])
      )
    )

    const usage = await fetchMiniMaxTokenPlanUsage(
      { apiKey: "mm-key" },
      {},
      1000
    )
    expect(usage.windows.map(({ label }) => label)).toStrictEqual([...labels])
    expect(
      usage.windows
        .filter(({ resetsAt }) => resetsAt === null)
        .map(({ label }) => label)
    ).toStrictEqual([...nullResetLabels])
  }
})

test("rejects a successful envelope without selectable model entries", async () => {
  installFetchMock(Response.json(successEnvelope([])))
  const error = await expectProviderError(
    fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  )
  expect(error.kind).toBe("decode")
})

test("accepts a weekly quota without a reported reset countdown", async () => {
  installFetchMock(
    Response.json(
      successEnvelope([
        generalEntry({ current_weekly_remaining_percent: 60 }),
      ])
    )
  )

  const usage = await fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  expect(usage.windows[1]?.resetsAt).toBeNull()
})

test("hides the weekly window when current_weekly_status is 3", async () => {
  installFetchMock(
    Response.json(
      successEnvelope([
        generalEntry({
          current_interval_remaining_percent: 91,
          current_weekly_remaining_percent: 100,
          current_weekly_status: 3,
          remains_time: fiveHourRemains,
          weekly_remains_time: weeklyRemains,
        }),
      ])
    )
  )

  const usage = await fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]).toMatchObject({
    label: "5h",
    quota: { remainingPercent: 91, usedPercent: 9 },
  })
})

test("hides the 5h window when current_interval_status is 3", async () => {
  installFetchMock(
    Response.json(
      successEnvelope([
        generalEntry({
          current_interval_remaining_percent: 100,
          current_interval_status: 3,
          current_weekly_remaining_percent: 80,
          current_weekly_status: 1,
          remains_time: fiveHourRemains,
          weekly_remains_time: weeklyRemains,
        }),
      ])
    )
  )

  const error = await expectProviderError(
    fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
  )
  expect(error.kind).toBe("decode")
})

test("does not use discovered OpenCode credentials for a custom host", async () => {
  const error = await expectProviderError(
    fetchMiniMaxTokenPlanUsage(
      { baseUrl: "https://minimax.example.test" },
      { minimax: { key: "discovered" } },
      1000
    )
  )
  expect(error.kind).toBe("missing_credentials")
})
