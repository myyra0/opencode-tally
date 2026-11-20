import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchNovitaAiBalanceUsage } from "../../../src/lib/quota/providers/novita-ai.js"

import { installFetchMock } from "./helpers.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
  delete process.env.NOVITA_API_KEY
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-novita-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, contents)
  return authPath
}

const response = (availableBalance: string | undefined) =>
  Response.json(availableBalance === undefined ? {} : { availableBalance })

async function expectProviderError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise
    throw new Error("expected a ProviderError")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError)
    return error as ProviderError
  }
}

test("requests the balance endpoint and converts $100 to USD", async () => {
  const fetchMock = installFetchMock(response("1000000"))

  const usage = await fetchNovitaAiBalanceUsage(
    { apiKey: "novita-key" },
    {},
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://api.novita.ai/openapi/v1/billing/balance/detail",
    {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer novita-key",
      },
      method: "GET",
    },
  ])
  expect(usage).toMatchObject({
    id: "novita-ai",
    label: "Novita AI",
    windows: [
      {
        kind: "credits",
        label: "balance",
        quota: { _tag: "Balance", remaining: 100, unit: "USD" },
        resetsAt: null,
      },
    ],
  })
})

test("converts whole-dollar and sub-cent amounts without using other fields", async () => {
  installFetchMock(
    Response.json({
      availableBalance: "1",
      cashBalance: "999999999",
      creditBalance: "999999999",
      debtBalance: "999999999",
    })
  )

  const usage = await fetchNovitaAiBalanceUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.windows[0]?.quota).toStrictEqual({
    _tag: "Balance",
    remaining: 0.0001,
    unit: "USD",
  })

  installFetchMock(response("10000"))
  const dollarUsage = await fetchNovitaAiBalanceUsage({ apiKey: "key" }, {}, 1000)
  expect(dollarUsage.windows[0]?.quota).toMatchObject({
    remaining: 1,
    unit: "USD",
  })

  installFetchMock(response("00010000"))
  const paddedUsage = await fetchNovitaAiBalanceUsage({ apiKey: "key" }, {}, 1000)
  expect(paddedUsage.windows[0]?.quota).toMatchObject({
    remaining: 1,
    unit: "USD",
  })
})

test("preserves a zero balance", async () => {
  installFetchMock(response("0"))

  const usage = await fetchNovitaAiBalanceUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.windows[0]?.quota).toStrictEqual({
    _tag: "Balance",
    remaining: 0,
    unit: "USD",
  })
})

test("rejects malformed available balances", async () => {
  const amounts: readonly (string | undefined)[] = [
    undefined,
    "",
    "-1",
    "1.5",
    "1e4",
    "NaN",
    "10000000000000000",
    "9007199254740992",
  ]

  for (const amount of amounts) {
    installFetchMock(response(amount))

    const error = await expectProviderError(
      fetchNovitaAiBalanceUsage({ apiKey: "key" }, {}, 1000)
    )

    expect(error.kind).toBe("decode")
  }
})

test("accepts the largest safe integer amount", async () => {
  installFetchMock(response("9007199254740991"))

  const usage = await fetchNovitaAiBalanceUsage({ apiKey: "key" }, {}, 1000)

  expect(usage.windows[0]?.quota).toMatchObject({
    remaining: Number.MAX_SAFE_INTEGER / 10_000,
    unit: "USD",
  })
})

test("uses auto-discovered OpenCode auth on the exact official origin", async () => {
  const fetchMock = installFetchMock(response("10000"))

  await fetchNovitaAiBalanceUsage(
    {},
    { "novita-ai": { key: "open-code-key" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer open-code-key" },
  })
})

test("does not send auto-discovered auth to a custom origin", async () => {
  const missing = await expectProviderError(
    fetchNovitaAiBalanceUsage(
      { baseUrl: "https://novita.example.test" },
      { "novita-ai": { key: "open-code-key" } },
      1000
    )
  )
  expect(missing.kind).toBe("missing_credentials")
  expect(missing.providerID).toBe("novita-ai")

  const fetchMock = installFetchMock(response("10000"))
  await fetchNovitaAiBalanceUsage(
    {
      apiKey: "explicit-key",
      baseUrl: "https://novita.example.test/v1?tenant=example#balance",
    },
    { "novita-ai": { key: "open-code-key" } },
    1000
  )

  expect(fetchMock.calls[0]).toMatchObject([
    "https://novita.example.test/v1/openapi/v1/billing/balance/detail?tenant=example",
    { headers: { Authorization: "Bearer explicit-key" } },
  ])
})

test("supports authPath and explicit environment credentials", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ "novita-ai": { apiKey: "file-key" } })
  )
  const fetchMock = installFetchMock(response("10000"))
  await fetchNovitaAiBalanceUsage(
    { apiKey: "config-key", authPath },
    {},
    1000
  )
  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer file-key" },
  })

  process.env.NOVITA_API_KEY = "environment-key"
  const envMock = installFetchMock(response("10000"))
  await fetchNovitaAiBalanceUsage(
    { apiKey: "{env:NOVITA_API_KEY}" },
    {},
    1000
  )
  expect(envMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer environment-key" },
  })
})

test("accepts flat auth-file credentials and ignores unrelated auth data", async () => {
  const authPath = await tempAuthPath(JSON.stringify({ key: "file-key" }))
  const fetchMock = installFetchMock(response("10000"))
  await fetchNovitaAiBalanceUsage({ authPath }, {}, 1000)
  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer file-key" },
  })

  const emptyAuthPath = await tempAuthPath(
    JSON.stringify({ ignored: true })
  )
  const fallbackMock = installFetchMock(response("10000"))
  await fetchNovitaAiBalanceUsage(
    { apiKey: "config-key", authPath: emptyAuthPath },
    {},
    1000
  )
  expect(fallbackMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer config-key" },
  })
})

test("classifies Novita AI HTTP failures as safe transport errors", async () => {
  for (const status of [401, 403, 500]) {
    installFetchMock(Response.json({ error: "secret-key" }, { status }))

    const error = await expectProviderError(
      fetchNovitaAiBalanceUsage({ apiKey: "secret-key" }, {}, 1000)
    )

    expect(error.kind).toBe("transport")
    expect(error.status).toBe(status)
    expect(error.providerID).toBe("novita-ai")
    expect(error.message).not.toContain("secret-key")
  }
})
