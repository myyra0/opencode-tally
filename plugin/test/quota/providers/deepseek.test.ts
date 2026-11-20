import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchDeepSeekBalanceUsage } from "../../../src/lib/quota/providers/deepseek.js"

import { installFetchMock } from "./helpers.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
  delete process.env.DEEPSEEK_API_KEY
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-deepseek-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, contents)
  return authPath
}

interface BalanceInfoInput {
  readonly currency?: string
  readonly granted_balance?: string | null
  readonly topped_up_balance?: string | null
  readonly total_balance?: string | null
}

const balance = (overrides: BalanceInfoInput = {}): BalanceInfoInput => ({
  currency: "USD",
  granted_balance: "10.00",
  topped_up_balance: "2.50",
  total_balance: "12.50",
  ...overrides,
})

const response = (
  balanceInfos: readonly BalanceInfoInput[],
  isAvailable = true
) => Response.json({ balance_infos: balanceInfos, is_available: isAvailable })

const SECRET = "deepseek-regression-api-key"

async function expectProviderError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise
    throw new Error("expected a ProviderError")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError)
    return error as ProviderError
  }
}

test("requests the official balance endpoint and preserves currencies independently", async () => {
  const fetchMock = installFetchMock(
    response([
      balance(),
      balance({
        currency: "CNY",
        granted_balance: "0.00",
        topped_up_balance: "0.00",
        total_balance: "0.00",
      }),
    ])
  )

  const usage = await fetchDeepSeekBalanceUsage(
    { apiKey: "deepseek-key", label: "My DeepSeek" },
    {},
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://api.deepseek.com/user/balance",
    {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer deepseek-key",
      },
      method: "GET",
    },
  ])
  expect(usage).toMatchObject({
    id: "deepseek",
    label: "My DeepSeek",
    metadata: { isAvailable: true },
    windows: [
      {
        kind: "credits",
        label: "USD",
        quota: { _tag: "Balance", remaining: 12.5, unit: "USD" },
        resetsAt: null,
      },
      {
        kind: "credits",
        label: "CNY",
        quota: { _tag: "Balance", remaining: 0, unit: "CNY" },
        resetsAt: null,
      },
    ],
  })
})

test("accepts a balance entry with only currency and total_balance", async () => {
  installFetchMock(response([{ currency: "USD", total_balance: "12.50" }]))

  const usage = await fetchDeepSeekBalanceUsage(
    { apiKey: "deepseek-key" },
    {},
    1000
  )

  expect(usage.windows).toMatchObject([
    {
      kind: "credits",
      label: "USD",
      quota: { _tag: "Balance", remaining: 12.5, unit: "USD" },
      resetsAt: null,
    },
  ])
})

test("keeps zero balances visible when the account is unavailable", async () => {
  installFetchMock(
    response(
      [
        balance({
          granted_balance: "0",
          topped_up_balance: "0",
          total_balance: "0",
        }),
      ],
      false
    )
  )

  const usage = await fetchDeepSeekBalanceUsage(
    { apiKey: "deepseek-key" },
    {},
    1000
  )

  expect(usage.metadata).toStrictEqual({ isAvailable: false })
  expect(usage.windows[0]?.quota).toStrictEqual({
    _tag: "Balance",
    remaining: 0,
    unit: "USD",
  })
})

test("skips malformed entries when another valid balance remains", async () => {
  installFetchMock(
    response([
      balance({ total_balance: "-1" }),
      balance({
        currency: "EUR",
        granted_balance: "1.00",
        topped_up_balance: "2.00",
        total_balance: "3.00",
      }),
      balance({ total_balance: "not-a-decimal" }),
    ])
  )

  const usage = await fetchDeepSeekBalanceUsage(
    { apiKey: "deepseek-key" },
    {},
    1000
  )

  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]).toMatchObject({
    label: "EUR",
    quota: { _tag: "Balance", remaining: 3, unit: "EUR" },
  })
})

test("fails closed when all balances are malformed", async () => {
  const overrides: readonly BalanceInfoInput[] = [
    { total_balance: null },
    { total_balance: "-1" },
    { total_balance: "1e3" },
    { total_balance: "NaN" },
    { total_balance: "Infinity" },
    { currency: "" },
  ]

  for (const entry of overrides) {
    installFetchMock(response([balance(entry)]))

    const error = await expectProviderError(
      fetchDeepSeekBalanceUsage({ apiKey: "deepseek-key" }, {}, 1000)
    )

    expect(error.kind).toBe("decode")
  }
})

test("requires the complete response envelope", async () => {
  for (const payload of [{ balance_infos: [balance()] }, { is_available: true }]) {
    installFetchMock(Response.json(payload))

    const error = await expectProviderError(
      fetchDeepSeekBalanceUsage({ apiKey: "deepseek-key" }, {}, 1000)
    )

    expect(error.kind).toBe("decode")
  }
})

test("classifies DeepSeek HTTP failures as safe transport errors", async () => {
  for (const status of [401, 403, 500]) {
    installFetchMock(
      Response.json(
        { error: SECRET },
        { headers: { "retry-after": "later" }, status }
      )
    )

    const error = await expectProviderError(
      fetchDeepSeekBalanceUsage({ apiKey: SECRET }, {}, 1000)
    )

    expect(error.kind).toBe("transport")
    expect(error.status).toBe(status)
    expect(error.providerID).toBe("deepseek")
    expect(error.message).not.toContain(SECRET)
    expect(String(error)).not.toContain(SECRET)
  }
})

test("classifies DeepSeek rate limits without leaking the API key", async () => {
  installFetchMock(
    Response.json(
      { error: SECRET },
      { headers: { "retry-after": "later" }, status: 429 }
    )
  )

  const error = await expectProviderError(
    fetchDeepSeekBalanceUsage({ apiKey: SECRET }, {}, 1000)
  )

  expect(error.kind).toBe("rate_limit")
  expect(error.providerID).toBe("deepseek")
  expect(error.retryAfterMs).toBeUndefined()
  expect(error.message).not.toContain(SECRET)
})

test("uses authPath before OpenCode auth and configured credentials", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ deepseek: { key: "file-key" } })
  )
  const fetchMock = installFetchMock(response([balance()]))

  await fetchDeepSeekBalanceUsage(
    { apiKey: "config-key", authPath },
    { deepseek: { key: "open-code-key" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer file-key" },
  })
})

test("uses the DeepSeek OpenCode auth provider before configured credentials", async () => {
  const fetchMock = installFetchMock(response([balance()]))

  await fetchDeepSeekBalanceUsage(
    { apiKey: "config-key" },
    { deepseek: { apiKey: "open-code-key" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer open-code-key" },
  })
})

test("resolves the explicit DeepSeek environment credential", async () => {
  process.env.DEEPSEEK_API_KEY = "environment-key"
  const fetchMock = installFetchMock(response([balance()]))

  await fetchDeepSeekBalanceUsage(
    { apiKey: "{env:DEEPSEEK_API_KEY}" },
    {},
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer environment-key" },
  })
})

test("requires explicit credentials for custom base URLs", async () => {
  await expectProviderError(
    fetchDeepSeekBalanceUsage(
      { baseUrl: "https://deepseek.example.test" },
      { deepseek: { key: "open-code-key" } },
      1000
    )
  ).then((error) => expect(error.kind).toBe("missing_credentials"))

  const fetchMock = installFetchMock(response([balance()]))
  await fetchDeepSeekBalanceUsage(
    { apiKey: "explicit-key", baseUrl: "https://deepseek.example.test" },
    { deepseek: { key: "open-code-key" } },
    1000
  )
  expect(fetchMock.calls[0]).toMatchObject([
    "https://deepseek.example.test/user/balance",
    { headers: { Authorization: "Bearer explicit-key" } },
  ])
})

test("appends the balance path before query and fragment components", async () => {
  const fetchMock = installFetchMock(response([balance()]))

  await fetchDeepSeekBalanceUsage(
    {
      apiKey: "explicit-key",
      baseUrl: "https://deepseek.example.test/v1?tenant=example#balance",
    },
    {},
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://deepseek.example.test/v1/user/balance?tenant=example",
    { headers: { Authorization: "Bearer explicit-key" } },
  ])
})
