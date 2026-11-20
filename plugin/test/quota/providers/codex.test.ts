import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { ProviderError } from "../../../src/lib/quota/errors.js"
import { fetchCodexUsage } from "../../../src/lib/quota/providers/codex.js"

import { installFetchMock, type FetchCall, type FetchMock } from "./helpers.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

async function tempAuthPath(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tally-codex-auth-"))
  tempDirs.push(dir)
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, contents)
  return authPath
}

/** Records calls while returning a sequence of responses (last one repeats). */
function installSequentialFetch(responses: Response[]): FetchMock {
  const calls: FetchCall[] = []
  let index = 0
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push([url, init])
    const response = responses[Math.min(index++, responses.length - 1)]!
    return Promise.resolve(response)
  }) as typeof fetch
  return { calls }
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

test("uses credentials from the configured Codex auth file", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({
      tokens: { access_token: "file-access", account_id: "file-account" },
    })
  )
  const fetchMock = installFetchMock(
    Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
  )

  await fetchCodexUsage({ authPath }, {}, 1000)

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: {
      Authorization: "Bearer file-access",
      "ChatGPT-Account-Id": "file-account",
    },
  })
})

test("falls back from an unreadable Codex auth file to the configured API key", async () => {
  const authPath = path.join(tmpdir(), `tally-missing-${crypto.randomUUID()}.json`)
  const fetchMock = installFetchMock(
    Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
  )

  await fetchCodexUsage({ apiKey: "fallback-key", authPath }, {}, 1000)

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: {
      Authorization: "Bearer fallback-key",
      "ChatGPT-Account-Id": "configured",
    },
  })
})

test("sends the tally User-Agent header", async () => {
  const fetchMock = installFetchMock(
    Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
  )

  await fetchCodexUsage(
    { apiKey: "configured-token", baseUrl: "https://codex.example" },
    {},
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: { "User-Agent": "opencode-tally" },
  })
})

test("falls back to Codex auth when OpenCode credentials are rejected", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({
      tokens: { access_token: "codex-access", account_id: "codex-account" },
    })
  )
  const fetchMock = installSequentialFetch([
    new Response(null, { status: 401 }),
    Response.json({ rate_limit: { primary_window: { used_percent: 13 } } }),
  ])

  const usage = await fetchCodexUsage(
    { authPath },
    { openai: { access: "expired-access", accountId: "openai-account" } },
    1000
  )

  expect(fetchMock.calls).toHaveLength(2)
  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: {
      Authorization: "Bearer expired-access",
      "ChatGPT-Account-Id": "openai-account",
    },
  })
  expect(fetchMock.calls[1]?.[1]).toMatchObject({
    headers: {
      Authorization: "Bearer codex-access",
      "ChatGPT-Account-Id": "codex-account",
    },
  })
  expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: 13 })
})

test("retries once with fallback credentials on 403", async () => {
  const fetchMock = installSequentialFetch([
    new Response(null, { status: 403 }),
    Response.json({ rate_limit: { primary_window: { used_percent: 13 } } }),
  ])

  await fetchCodexUsage(
    { apiKey: "fallback-token" },
    { openai: { access: "expired-access", accountId: "openai-account" } },
    1000
  )

  expect(fetchMock.calls).toHaveLength(2)
  expect(fetchMock.calls[1]?.[1]).toMatchObject({
    headers: { Authorization: "Bearer fallback-token" },
  })
})

test("preserves a configured API key during the auth fallback", async () => {
  const fetchMock = installSequentialFetch([
    new Response(null, { status: 401 }),
    Response.json({ rate_limit: { primary_window: { used_percent: 13 } } }),
  ])

  await fetchCodexUsage(
    { apiKey: "configured-token" },
    { openai: { access: "expired-access", accountId: "openai-account" } },
    1000
  )

  expect(fetchMock.calls[1]?.[1]).toMatchObject({
    headers: {
      Authorization: "Bearer configured-token",
      "ChatGPT-Account-Id": "openai-account",
    },
  })
})

test("rejects a missing configured Codex auth file", async () => {
  const authPath = path.join(tmpdir(), `tally-missing-${crypto.randomUUID()}.json`)

  const error = await expectProviderError(fetchCodexUsage({ authPath }, {}, 1000))

  expect(error.kind).toBe("missing_credentials")
  expect(error.providerID).toBe("codex")
})

test("rejects auth files without complete credentials", async () => {
  const authPath = await tempAuthPath(
    JSON.stringify({ tokens: { access_token: "token" } })
  )

  const error = await expectProviderError(fetchCodexUsage({ authPath }, {}, 1000))

  expect(error.kind).toBe("missing_credentials")
})

test("rejects malformed auth file payloads", async () => {
  for (const contents of ["null", "{}", JSON.stringify({ tokens: "bad" })]) {
    const authPath = await tempAuthPath(contents)
    const error = await expectProviderError(fetchCodexUsage({ authPath }, {}, 1000))
    expect(error.kind).toBe("missing_credentials")
  }
})

test("does not retry unauthorized requests for a custom host", async () => {
  const fetchMock = installFetchMock(new Response(null, { status: 401 }))

  const error = await expectProviderError(
    fetchCodexUsage(
      { apiKey: "configured-token", baseUrl: "https://codex.example" },
      { openai: { access: "expired-access", accountId: "account" } },
      1000
    )
  )

  expect(error.kind).toBe("transport")
  expect(error.status).toBe(401)
  expect(fetchMock.calls).toHaveLength(1)
})

test("ignores optional response fields with invalid types", async () => {
  installFetchMock(
    Response.json({
      plan_type: 42,
      rate_limit: {
        primary_window: {
          limit_window_seconds: "wrong",
          reset_at: "wrong",
          used_percent: 0,
        },
        secondary_window: null,
      },
      rate_limit_reset_credits: { available_count: "wrong" },
    })
  )

  const usage = await fetchCodexUsage(
    { apiKey: "configured-token", baseUrl: "https://codex.example" },
    {},
    1000
  )

  expect(usage.metadata).toMatchObject({ resetCredits: null })
  expect(usage.tierName).toBeUndefined()
})

test("accepts a window with no optional fields and omits invalid nested windows", async () => {
  installFetchMock(
    Response.json({
      rate_limit: {
        primary_window: {},
        secondary_window: { used_percent: "invalid" },
      },
    })
  )

  const usage = await fetchCodexUsage(
    { apiKey: "configured-token", baseUrl: "https://codex.example" },
    {},
    1000
  )

  expect(usage.windows).toMatchObject([
    { kind: "other", label: "usage", quota: { _tag: "Unknown" }, resetsAt: null },
  ])
})

test("treats non-object optional Codex windows as absent", async () => {
  installFetchMock(
    Response.json({
      plan_type: 42,
      rate_limit: { primary_window: null, secondary_window: null },
    })
  )

  const error = await expectProviderError(
    fetchCodexUsage(
      { apiKey: "configured-token", baseUrl: "https://codex.example" },
      {},
      1000
    )
  )

  expect(error.kind).toBe("decode")
})

test("rejects invalid primary window percentages", async () => {
  installFetchMock(
    Response.json({ rate_limit: { primary_window: { used_percent: 101 } } })
  )

  const error = await expectProviderError(
    fetchCodexUsage(
      { apiKey: "configured-token", baseUrl: "https://codex.example" },
      {},
      1000
    )
  )

  expect(error.kind).toBe("decode")
})

test("keeps the original unauthorized error when fallback credentials are unavailable", async () => {
  const authPath = path.join(tmpdir(), `tally-missing-${crypto.randomUUID()}.json`)
  const fetchMock = installFetchMock(new Response(null, { status: 401 }))

  const error = await expectProviderError(
    fetchCodexUsage(
      { authPath },
      { openai: { access: "expired-access", accountId: "account" } },
      1000
    )
  )

  expect(error.kind).toBe("transport")
  expect(error.status).toBe(401)
  expect(fetchMock.calls).toHaveLength(1)
})

test("builds authenticated requests and parses usage windows", async () => {
  const fetchMock = installFetchMock(
    Response.json({
      plan_type: "team",
      rate_limit: {
        primary_window: {
          limit_window_seconds: 18_000,
          reset_after_seconds: 3600,
          reset_at: 1_782_216_000,
          used_percent: 100,
        },
        secondary_window: {
          limit_window_seconds: 86_400,
          reset_after_seconds: 7200,
          used_percent: 0,
        },
      },
      rate_limit_reset_credits: { available_count: 2 },
    })
  )

  const before = Date.now()
  const usage = await fetchCodexUsage(
    {
      apiKey: "configured-token",
      baseUrl: "https://codex.example/",
      label: "Codex",
    },
    { openai: { access: "access-token", accountId: "account-id" } },
    1000
  )
  const after = Date.now()

  expect(fetchMock.calls[0]?.[0]).toBe("https://codex.example/wham/usage")
  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: {
      Authorization: "Bearer configured-token",
      "ChatGPT-Account-Id": "configured",
    },
    method: "GET",
  })
  expect(usage).toMatchObject({
    id: "codex",
    label: "Codex",
    metadata: { resetCredits: 2 },
    tierName: "team",
  })
  expect(usage.capturedAt).toBeGreaterThanOrEqual(before)
  expect(usage.capturedAt).toBeLessThanOrEqual(after)
  expect(usage.windows).toMatchObject([
    { label: "5h", quota: { remainingPercent: 0, usedPercent: 100 } },
    { label: "daily", quota: { remainingPercent: 100, usedPercent: 0 } },
  ])
  expect(usage.windows[0]?.resetsAt).toBe(1_782_216_000 * 1000)
})

test("classifies windows by duration and reads a monthly tertiary window", async () => {
  installFetchMock(
    Response.json({
      rate_limit: {
        primary_window: { limit_window_seconds: 18_000, used_percent: 10 },
        secondary_window: { limit_window_seconds: 604_800, used_percent: 20 },
        tertiary_window: {
          limit_window_seconds: 2_628_000,
          reset_at: 1_800_000_000,
          used_percent: 30,
        },
      },
    })
  )

  const usage = await fetchCodexUsage(
    undefined,
    { openai: { access: "access-token", accountId: "account-id" } },
    1000
  )

  expect(usage.windows.map((window) => [window.label, window.kind])).toEqual([
    ["5h", "rolling"],
    ["weekly", "weekly"],
    ["monthly", "monthly"],
  ])
  expect(usage.windows[2]?.resetsAt).toBe(1_800_000_000 * 1000)
})

test("rejects malformed Codex responses", async () => {
  installFetchMock(Response.json([]))

  const error = await expectProviderError(
    fetchCodexUsage(
      undefined,
      { openai: { access: "access-token", accountId: "account-id" } },
      1000
    )
  )

  expect(error.kind).toBe("decode")
})

test("does not use discovered OpenCode credentials for a custom host", async () => {
  const error = await expectProviderError(
    fetchCodexUsage(
      { baseUrl: "https://codex.example/" },
      { openai: { access: "discovered", accountId: "discovered" } },
      1000
    )
  )

  expect(error.kind).toBe("missing_credentials")
})

test("allows safe base URLs", async () => {
  const cases = [
    ["http://localhost:3000/", "http://localhost:3000/wham/usage"],
    ["http://127.0.0.1:4321", "http://127.0.0.1:4321/wham/usage"],
    ["http://[::1]:3000", "http://[::1]:3000/wham/usage"],
    ["https://chatgpt.com/backend-api/", "https://chatgpt.com/backend-api/wham/usage"],
  ] as const

  for (const [baseUrl, expectedUrl] of cases) {
    const fetchMock = installFetchMock(
      Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
    )

    await fetchCodexUsage(
      { apiKey: "configured-token", baseUrl },
      { openai: { access: "token", accountId: "account" } },
      1000
    )

    expect(fetchMock.calls[0]?.[0]).toBe(expectedUrl)
  }
})

test("falls back from unsafe base URLs", async () => {
  const cases = [
    ["http://evil.example", "https://chatgpt.com/backend-api/wham/usage"],
    ["ftp://example.com", "https://chatgpt.com/backend-api/wham/usage"],
    ["not a url", "https://chatgpt.com/backend-api/wham/usage"],
  ] as const

  for (const [baseUrl, expectedUrl] of cases) {
    const fetchMock = installFetchMock(
      Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
    )

    await fetchCodexUsage(
      { apiKey: "configured-token", baseUrl },
      { openai: { access: "token", accountId: "account" } },
      1000
    )

    expect(fetchMock.calls[0]?.[0]).toBe(expectedUrl)
  }
})

test("window variants", async () => {
  const windowPayload = (usedPercent: number) => ({
    plan_type: "team",
    rate_limit: {
      primary_window: {
        limit_window_seconds: 18_000,
        reset_after_seconds: 3600,
        reset_at: 1_782_216_000,
        used_percent: usedPercent,
      },
    },
  })

  installFetchMock(Response.json(windowPayload(50)))
  const primaryOnly = await fetchCodexUsage(
    { apiKey: "configured-token", baseUrl: "https://codex.example/" },
    {},
    1000
  )
  expect(primaryOnly.windows).toHaveLength(1)
  expect(primaryOnly.windows[0]).toMatchObject({
    label: "5h",
    quota: { remainingPercent: 50, usedPercent: 50 },
  })

  installFetchMock(
    Response.json({
      ...windowPayload(100),
      rate_limit: {
        ...windowPayload(100).rate_limit,
        secondary_window: { limit_window_seconds: 86_400, used_percent: 0 },
      },
      rate_limit_reset_credits: { available_count: 5 },
    })
  )
  const both = await fetchCodexUsage(
    { apiKey: "configured-token", baseUrl: "https://codex.example/" },
    {},
    1000
  )
  expect(both.windows).toHaveLength(2)
  expect(both.windows[1]).toMatchObject({
    label: "daily",
    quota: { remainingPercent: 100, usedPercent: 0 },
  })
  expect(both.metadata).toMatchObject({ resetCredits: 5 })
  expect(both.tierName).toBe("team")
})

test("rejects invalid required percentages", async () => {
  for (const usedPercent of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    installFetchMock(
      Response.json({
        rate_limit: {
          primary_window: {
            limit_window_seconds: 18_000,
            used_percent: usedPercent,
          },
        },
      })
    )

    const error = await expectProviderError(
      fetchCodexUsage(
        { apiKey: "configured-token", baseUrl: "https://codex.example" },
        {},
        1000
      )
    )

    expect(error.kind).toBe("decode")
  }
})

test("falls back to reset_after_seconds when reset_at is absent", async () => {
  installFetchMock(
    Response.json({
      rate_limit: {
        primary_window: {
          limit_window_seconds: 18_000,
          reset_after_seconds: 600,
          used_percent: 10,
        },
      },
    })
  )

  const before = Date.now()
  const usage = await fetchCodexUsage(
    { apiKey: "configured-token", baseUrl: "https://codex.example" },
    {},
    1000
  )

  expect(usage.windows[0]).toMatchObject({ kind: "rolling", label: "5h" })
  expect(usage.windows[0]?.resetsAt).toBeGreaterThanOrEqual(before + 600_000)
  expect(usage.windows[0]?.resetsAt).toBeLessThanOrEqual(Date.now() + 600_000)
})

test("ignores chatgpt-token-sharing openai credential in favour of configured apiKey", async () => {
  const fetchMock = installFetchMock(
    Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
  )

  await fetchCodexUsage(
    { apiKey: "configured-key", baseUrl: "https://chatgpt.com/backend-api" },
    { openai: { access: "shared-access", accountId: "shared-account", methodID: "chatgpt-token-sharing" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: {
      Authorization: "Bearer configured-key",
    },
  })
})

test("uses chatgpt-browser openai credential and sends ChatGPT-Account-Id", async () => {
  const fetchMock = installFetchMock(
    Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
  )

  await fetchCodexUsage(
    { baseUrl: "https://chatgpt.com/backend-api" },
    { openai: { access: "browser-access", accountId: "browser-account", methodID: "chatgpt-browser" } },
    1000
  )

  expect(fetchMock.calls[0]?.[1]).toMatchObject({
    headers: {
      Authorization: "Bearer browser-access",
      "ChatGPT-Account-Id": "browser-account",
    },
  })
})
