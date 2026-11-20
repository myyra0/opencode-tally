import { afterEach, expect, test } from "bun:test"

import { ProviderError } from "../../src/lib/quota/errors.js"
import { requestJson } from "../../src/lib/quota/http.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function request(overrides: Partial<Parameters<typeof requestJson>[0]> = {}) {
  return requestJson({
    url: "https://example.com/usage",
    headers: {},
    method: "GET",
    providerID: "deepseek",
    timeoutMs: 1000,
    ...overrides,
  })
}

async function expectProviderError(promise: Promise<unknown>) {
  try {
    await promise
    throw new Error("expected a ProviderError")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError)
    return error as ProviderError
  }
}

test("requestJson returns decoded JSON for a successful response", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ remaining: 5 }))

  expect(await request()).toEqual({ remaining: 5 })
})

test("an unexpected status becomes a transport error without leaking body text", async () => {
  globalThis.fetch = async () => new Response("SECRET_BODY", { status: 451 })

  const error = await expectProviderError(request())

  expect(error.kind).toBe("transport")
  expect(error.status).toBe(451)
  expect(error.providerID).toBe("deepseek")
  expect(error.message).not.toContain("SECRET_BODY")
})

test("429 sets retryAfterMs from Retry-After seconds", async () => {
  globalThis.fetch = async () =>
    new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "2" },
    })

  const error = await expectProviderError(request())

  expect(error.kind).toBe("rate_limit")
  expect(error.retryAfterMs).toBe(2000)
  expect(error.status).toBe(429)
})

test("401 and 403 become transport errors carrying the status", async () => {
  globalThis.fetch = async () => new Response("nope", { status: 401 })
  expect((await expectProviderError(request())).kind).toBe("transport")
  expect((await expectProviderError(request())).status).toBe(401)

  globalThis.fetch = async () => new Response("nope", { status: 403 })
  const forbidden = await expectProviderError(request())
  expect(forbidden.kind).toBe("transport")
  expect(forbidden.status).toBe(403)
})

test("invalid JSON becomes a decode error", async () => {
  globalThis.fetch = async () => new Response("not json")

  const error = await expectProviderError(request())

  expect(error.kind).toBe("decode")
  expect(error.message).not.toContain("not json")
})

test("a body over 2 MiB becomes a decode error", async () => {
  const body = "x".repeat(2 * 1024 * 1024 + 1)
  globalThis.fetch = async () => new Response(body)

  const error = await expectProviderError(request())

  expect(error.kind).toBe("decode")
})

test("an aborted request becomes a timeout error", async () => {
  globalThis.fetch = ((_input: unknown, init: RequestInit | undefined) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    })) as typeof fetch

  const error = await expectProviderError(request({ timeoutMs: 25 }))

  expect(error.kind).toBe("timeout")
})
