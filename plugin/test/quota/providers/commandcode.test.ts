// Command Code adapter tests. Global fetch is replaced with a sequential response queue
// through the shared helper.

import { expect, test } from "bun:test"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import {
  commandCodeProvider,
  fetchCommandCodeUsage,
} from "../../../src/lib/quota/providers/commandcode.js"

import { installFetchResponses } from "./helpers.js"

type JsonObject = Record<string, unknown>

const whoami = (orgId?: string | number): Response =>
  Response.json(
    orgId === undefined
      ? { success: true, user: { id: "user_fixture" } }
      : { org: { id: orgId }, success: true }
  )

const defaultWindowLimits: JsonObject = {
  fiveHour: { cap: 14, resetAt: 1_789_810_659_226, used: 7 },
  weekly: { cap: 35, resetAt: 1_790_397_459_226, used: 7 },
}

const defaultCredits: JsonObject = {
  freeCredits: 0,
  monthlyCredits: 70,
  purchasedCredits: 5,
}

const creditsWith = (windowLimits: JsonObject, accountCredits: unknown): Response =>
  Response.json({ credits: accountCredits, windowLimits })

const credits = (): Response => creditsWith(defaultWindowLimits, defaultCredits)

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

test("reads and scopes credit windows and derives monthly usage", async () => {
  const fetchMock = installFetchResponses([
    whoami("org_fixture"),
    credits(),
    Response.json({ totalCredits: 5 }),
  ])

  const before = Date.now()
  const usage = await fetchCommandCodeUsage(
    undefined,
    { commandcode: { key: "cc-token" } },
    1000
  )
  const after = Date.now()

  expect(fetchMock.calls.map(([url]) => String(url))).toStrictEqual([
    "https://api.commandcode.ai/alpha/whoami?limits=1",
    "https://api.commandcode.ai/alpha/billing/credits?orgId=org_fixture",
    "https://api.commandcode.ai/alpha/usage/summary?orgId=org_fixture",
  ])
  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer cc-token" },
    method: "GET",
  })
  expect(usage).toMatchObject({ id: "commandcode", label: "Command Code" })
  expect(usage.capturedAt).toBeGreaterThanOrEqual(before)
  expect(usage.capturedAt).toBeLessThanOrEqual(after)
  expect(usage.windows).toMatchObject([
    {
      kind: "rolling",
      label: "5h",
      quota: { usedPercent: 50 },
      resetsAt: 1_789_810_659_226,
    },
    {
      kind: "weekly",
      quota: { usedPercent: 20 },
      resetsAt: 1_790_397_459_226,
    },
    { kind: "monthly", quota: { usedPercent: 6.25 } },
  ])
})

test("omits organization scope for personal accounts", async () => {
  const fetchMock = installFetchResponses([
    whoami(),
    credits(),
    Response.json({ totalCredits: 5 }),
  ])

  await fetchCommandCodeUsage(
    undefined,
    { commandcode: { key: "cc-token" } },
    1000
  )

  expect(fetchMock.calls.map(([url]) => String(url))).toStrictEqual([
    "https://api.commandcode.ai/alpha/whoami?limits=1",
    "https://api.commandcode.ai/alpha/billing/credits",
    "https://api.commandcode.ai/alpha/usage/summary",
  ])
})

test("scopes requests to an organization nested under data", async () => {
  const fetchMock = installFetchResponses([
    Response.json({ data: { organization: { id: "org_nested" } } }),
    credits(),
    Response.json({ totalCost: 5 }),
  ])

  await fetchCommandCodeUsage(undefined, { apiKey: "cc-token" }, 1000)

  expect(fetchMock.calls.map(([url]) => String(url))).toStrictEqual([
    "https://api.commandcode.ai/alpha/whoami?limits=1",
    "https://api.commandcode.ai/alpha/billing/credits?orgId=org_nested",
    "https://api.commandcode.ai/alpha/usage/summary?orgId=org_nested",
  ])
})

for (const [label, body] of [
  ["null", null],
  ["empty", {}],
  ["missing user", { success: true }],
  ["missing user id", { user: {} }],
  ["invalid organization", { org: { id: 42 }, user: { id: "user" } }],
] as const) {
  test(`rejects ${label} whoami payloads before billing requests`, async () => {
    const fetchMock = installFetchResponses([Response.json(body)])

    const error = await expectProviderError(
      fetchCommandCodeUsage(undefined, { commandcode: { key: "key" } }, 1000)
    )

    expect(error.kind).toBe("decode")
    expect(fetchMock.calls).toHaveLength(1)
  })
}

test("fails when nested whoami reports an unsuccessful response", async () => {
  const fetchMock = installFetchResponses([
    Response.json({ data: { success: false } }),
  ])

  const error = await expectProviderError(
    fetchCommandCodeUsage(undefined, { commandcode: { apiKey: "key" } }, 1000)
  )

  expect(error.kind).toBe("decode")
  expect(fetchMock.calls).toHaveLength(1)
})

test("keeps monthly quota unknown when its summary request fails", async () => {
  installFetchResponses([
    whoami(),
    credits(),
    new Response(null, { status: 500 }),
  ])

  const usage = await fetchCommandCodeUsage(
    undefined,
    { commandcode: { key: "cc-token" } },
    1000
  )

  expect(usage.windows.at(-1)).toMatchObject({
    kind: "monthly",
    quota: { _tag: "Unknown" },
  })
})

test("keeps monthly quota unknown when summary usage is malformed", async () => {
  installFetchResponses([
    whoami(),
    credits(),
    Response.json({ totalCredits: "bad" }),
  ])

  const usage = await fetchCommandCodeUsage(
    undefined,
    { commandcode: { key: "cc-token" } },
    1000
  )

  expect(usage.windows.at(-1)).toMatchObject({
    kind: "monthly",
    quota: { _tag: "Unknown" },
  })
})

for (const [label, accountCredits] of [
  ["missing credits", null],
  [
    "invalid credit balances",
    { freeCredits: 0, monthlyCredits: "bad", purchasedCredits: 0 },
  ],
  [
    "empty credit pool",
    { freeCredits: 0, monthlyCredits: 0, purchasedCredits: 0 },
  ],
] as const) {
  test(`omits monthly usage with ${label}`, async () => {
    installFetchResponses([
      whoami(),
      creditsWith(defaultWindowLimits, accountCredits),
      Response.json({ totalCredits: 0 }),
    ])

    const usage = await fetchCommandCodeUsage(
      undefined,
      { commandcode: { key: "cc-token" } },
      1000
    )

    expect(usage.windows).toHaveLength(2)
  })
}

test("omits unusable credit buckets but keeps valid windows", async () => {
  installFetchResponses([
    whoami(),
    creditsWith(
      {
        fiveHour: { cap: 0, used: 1 },
        weekly: { cap: 35, used: 7 },
      },
      defaultCredits
    ),
    Response.json({ totalCredits: 5 }),
  ])

  const usage = await fetchCommandCodeUsage(
    undefined,
    { commandcode: { key: "cc-token" } },
    1000
  )

  expect(usage.windows.map((window) => window.kind)).toStrictEqual([
    "weekly",
    "monthly",
  ])
})

test("rejects malformed billing responses and empty window sets", async () => {
  installFetchResponses([whoami(), Response.json({ credits: {} })])
  const first = await expectProviderError(
    fetchCommandCodeUsage(undefined, { commandcode: { key: "cc-token" } }, 1000)
  )
  expect(first.kind).toBe("decode")

  installFetchResponses([
    whoami(),
    creditsWith({ fiveHour: null, weekly: null }, null),
    Response.json({ totalCredits: 5 }),
  ])
  const second = await expectProviderError(
    fetchCommandCodeUsage(undefined, { commandcode: { key: "cc-token" } }, 1000)
  )
  expect(second.kind).toBe("decode")
})

test("does not issue unscoped requests when whoami fails", async () => {
  const fetchMock = installFetchResponses([
    new Response(null, { status: 500 }),
  ])

  const error = await expectProviderError(
    fetchCommandCodeUsage(undefined, { commandcode: { key: "cc-token" } }, 1000)
  )

  expect(error.kind).toBe("transport")
  expect(fetchMock.calls).toHaveLength(1)
})

test("supports explicit keys with custom base URL paths and queries", async () => {
  const fetchMock = installFetchResponses([
    whoami(),
    credits(),
    Response.json({ totalCredits: 5 }),
  ])

  await fetchCommandCodeUsage(
    {
      apiKey: "configured-token",
      baseUrl:
        "https://cc.example.test/proxy?orgId=untrusted&tenant=workspace#section",
    },
    { commandcode: { key: "must-not-leak" } },
    1000
  )

  expect(fetchMock.calls.map(([url]) => String(url))).toStrictEqual([
    "https://cc.example.test/proxy/alpha/whoami?tenant=workspace&limits=1",
    "https://cc.example.test/proxy/alpha/billing/credits?tenant=workspace",
    "https://cc.example.test/proxy/alpha/usage/summary?tenant=workspace",
  ])
  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer configured-token" },
  })
})

test("rejects missing credentials and explicit whoami failure bodies", async () => {
  for (const auth of [{}, { commandcode: {} }]) {
    const error = await expectProviderError(
      fetchCommandCodeUsage(undefined, auth, 1000)
    )
    expect(error.kind).toBe("missing_credentials")
    expect(error.message).toContain("missing Command Code key")
  }

  const fetchMock = installFetchResponses([
    Response.json({ message: "unauthenticated", success: false }),
  ])

  const error = await expectProviderError(
    fetchCommandCodeUsage(undefined, { commandcode: { key: "cc-token" } }, 1000)
  )
  expect(error.kind).toBe("decode")
  expect(fetchMock.calls).toHaveLength(1)
})

test("registers with the expected display metadata", () => {
  expect(commandCodeProvider).toMatchObject({
    defaultLabel: "Command Code",
    displayOrder: 6,
    footerWindowKind: "rolling",
    id: "commandcode",
    openCodeProviderIDs: ["commandcode"],
  })
})
