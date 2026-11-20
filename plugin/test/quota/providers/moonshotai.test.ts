import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { OpenCodeAuth } from "../../../src/lib/quota/auth.js"
import { ProviderError } from "../../../src/lib/quota/errors.js"
import {
  fetchMoonshotAiBalanceUsage,
  fetchMoonshotAiCnBalanceUsage,
} from "../../../src/lib/quota/providers/moonshotai.js"

import { installFetchMock } from "./helpers.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-moonshot-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, contents)
  return authPath
}

const response = (
  availableBalance: number,
  overrides: { readonly code?: number; readonly status?: boolean } = {}
) =>
  Response.json({
    code: 0,
    data: {
      available_balance: availableBalance,
      cash_balance: -100,
      voucher_balance: 200,
    },
    scode: "0x0",
    status: true,
    ...overrides,
  })

async function expectProviderError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise
    throw new Error("expected a ProviderError")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError)
    return error as ProviderError
  }
}

interface MoonshotFetch {
  (
    config: { apiKey?: string; authPath?: string; baseUrl?: string } | undefined,
    auth: OpenCodeAuth,
    timeoutMs: number
  ): Promise<{ id: string; windows: readonly unknown[] }>
}

test("fetches each region's balance using available_balance", async () => {
  const cases: readonly (readonly [
    string,
    string,
    MoonshotFetch,
    string,
    string,
    number,
  ])[] = [
    [
      "global USD",
      "moonshotai",
      fetchMoonshotAiBalanceUsage,
      "https://api.moonshot.ai/v1/users/me/balance",
      "USD",
      49.58894,
    ],
    [
      "China CNY",
      "moonshotai-cn",
      fetchMoonshotAiCnBalanceUsage,
      "https://api.moonshot.cn/v1/users/me/balance",
      "CNY",
      49.58894,
    ],
  ]

  for (const [_name, id, fetchBalance, url, currency, amount] of cases) {
    const fetchMock = installFetchMock(response(amount))
    const usage = await fetchBalance({ apiKey: "region-key" }, {}, 1000)

    expect(fetchMock.calls[0]).toMatchObject([
      url,
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer region-key",
        },
        method: "GET",
      },
    ])
    expect(usage).toMatchObject({
      id,
      windows: [
        {
          kind: "credits",
          label: `${currency} balance`,
          quota: { _tag: "Balance", remaining: amount, unit: currency },
          resetsAt: null,
        },
      ],
    })
  }
})

test("preserves zero and negative available balances", async () => {
  for (const amount of [0, -3.25]) {
    installFetchMock(response(amount))

    const usage = await fetchMoonshotAiBalanceUsage(
      { apiKey: "global-key" },
      {},
      1000
    )

    expect(usage.windows[0]?.quota).toStrictEqual({
      _tag: "Balance",
      remaining: amount,
      unit: "USD",
    })
  }
})

test("fails closed for malformed payloads", async () => {
  const payloads: readonly unknown[] = [
    null,
    { code: 0, status: true },
    { code: 0, data: {}, status: true },
    { code: 0, data: null, status: true },
    { code: 0, data: { available_balance: "1.25" }, status: true },
    { code: 0, data: { available_balance: 1 } },
    { code: 0, data: { available_balance: 1 }, status: false },
    { code: 1, data: { available_balance: 1 }, status: true },
  ]

  for (const payload of payloads) {
    installFetchMock(Response.json(payload))

    const error = await expectProviderError(
      fetchMoonshotAiBalanceUsage({ apiKey: "global-key" }, {}, 1000)
    )

    expect(error.kind).toBe("decode")
  }
})

test("rejects numeric overflow as a non-finite balance", async () => {
  installFetchMock(
    new Response(
      '{"code":0,"status":true,"data":{"available_balance":1e999}}',
      { headers: { "content-type": "application/json" } }
    )
  )

  const error = await expectProviderError(
    fetchMoonshotAiBalanceUsage({ apiKey: "global-key" }, {}, 1000)
  )

  expect(error.kind).toBe("decode")
})

test("classifies HTTP 401 as a safe transport error", async () => {
  const secret = "moonshot-secret-api-key"
  installFetchMock(Response.json({ error: secret }, { status: 401 }))

  const error = await expectProviderError(
    fetchMoonshotAiBalanceUsage({ apiKey: secret }, {}, 1000)
  )

  expect(error.kind).toBe("transport")
  expect(error.status).toBe(401)
  expect(error.message).not.toContain(secret)
  expect(String(error)).not.toContain(secret)
})

test("uses only each provider's matching OpenCode credential", async () => {
  const auth = {
    moonshotai: { key: "global-key" },
    "moonshotai-cn": { key: "china-key" },
  }

  const globalMock = installFetchMock(response(1))
  await fetchMoonshotAiBalanceUsage({}, auth, 1000)
  expect(globalMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer global-key" },
  })

  const chinaMock = installFetchMock(response(2))
  await fetchMoonshotAiCnBalanceUsage({}, auth, 1000)
  expect(chinaMock.calls[0]).toMatchObject([
    "https://api.moonshot.cn/v1/users/me/balance",
    { headers: { Authorization: "Bearer china-key" } },
  ])
})

test("reads region-specific credentials from the configured auth file", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({
      moonshotai: { key: "auth-file-global" },
      "moonshotai-cn": { apiKey: "auth-file-china" },
    })
  )

  const globalMock = installFetchMock(response(1))
  await fetchMoonshotAiBalanceUsage({ authPath }, {}, 1000)
  expect(globalMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer auth-file-global" },
  })

  const chinaMock = installFetchMock(response(2))
  await fetchMoonshotAiCnBalanceUsage({ authPath }, {}, 1000)
  expect(chinaMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer auth-file-china" },
  })
})

test("accepts direct auth-file keys and ignores malformed provider entries", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ apiKey: "direct-file-key" })
  )
  const fetchMock = installFetchMock(response(1))
  await fetchMoonshotAiBalanceUsage({ authPath }, {}, 1000)
  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer direct-file-key" },
  })

  const malformedPath = await tempAuthPath(
    JSON.stringify({ moonshotai: null })
  )
  const fallbackMock = installFetchMock(response(1))
  await fetchMoonshotAiBalanceUsage(
    { apiKey: "explicit-fallback", authPath: malformedPath },
    {},
    1000
  )
  expect(fallbackMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer explicit-fallback" },
  })
})

test("does not cross-send a region key when the matching credential is absent", async () => {
  const globalError = await expectProviderError(
    fetchMoonshotAiBalanceUsage(
      {},
      { "moonshotai-cn": { key: "china-key" } },
      1000
    )
  )
  expect(globalError.kind).toBe("missing_credentials")
  expect(globalError.providerID).toBe("moonshotai")

  const chinaError = await expectProviderError(
    fetchMoonshotAiCnBalanceUsage(
      {},
      { moonshotai: { key: "global-key" } },
      1000
    )
  )
  expect(chinaError.kind).toBe("missing_credentials")
  expect(chinaError.providerID).toBe("moonshotai-cn")
})

test("requires explicit credentials for custom origins", async () => {
  const cases: readonly (readonly [
    string,
    MoonshotFetch,
    string,
    OpenCodeAuth,
  ])[] = [
    [
      "global",
      fetchMoonshotAiBalanceUsage,
      "https://proxy.example.test",
      { moonshotai: { key: "discovered" } },
    ],
    [
      "China",
      fetchMoonshotAiCnBalanceUsage,
      "https://api.moonshot.ai",
      { "moonshotai-cn": { key: "discovered" } },
    ],
  ]

  for (const [_label, fetchBalance, baseUrl, auth] of cases) {
    const error = await expectProviderError(fetchBalance({ baseUrl }, auth, 1000))
    expect(error.kind).toBe("missing_credentials")

    const fetchMock = installFetchMock(response(1))
    await fetchBalance({ apiKey: "explicit-key", baseUrl }, auth, 1000)
    expect(fetchMock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer explicit-key" },
    })
  }
})
