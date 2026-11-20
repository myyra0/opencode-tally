// Qwen Token Plan adapter tests. The injected command runner replaces a real executor,
// so no fake executable is needed.

import { expect, test } from "bun:test"

import type { RunCommandInput } from "../../../src/lib/quota/command.js"
import { ProviderError } from "../../../src/lib/quota/errors.js"
import {
  fetchQwenTokenPlanUsage,
  qwenProvider,
} from "../../../src/lib/quota/providers/qwen.js"

type CommandResult = string | ProviderError

const authenticated = JSON.stringify({
  authenticated: true,
  server_verified: true,
})

function createRun(auth: CommandResult, usage: CommandResult = "") {
  const calls: RunCommandInput[] = []
  const run = (input: RunCommandInput): Promise<string> => {
    calls.push(input)
    const result = input.args[0] === "auth" ? auth : usage
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result)
  }
  return { calls, run }
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

test("fetches authenticated usage through the qwencloud CLI boundary", async () => {
  const { calls, run } = createRun(
    authenticated,
    JSON.stringify({
      token_plan: {
        planName: "Plus",
        remainingCredits: 250,
        resetDate: "2026-08-14T13:00:01.000Z",
        subscribed: true,
        totalCredits: 1000,
        usedPct: 75,
      },
    })
  )

  const before = Date.now()
  const usage = await fetchQwenTokenPlanUsage(undefined, {}, 4321, run)
  const after = Date.now()

  expect(calls).toStrictEqual([
    {
      acceptedExitCodes: new Set([2]),
      args: ["auth", "status", "--format", "json"],
      command: "qwencloud",
      providerID: "qwen",
      timeoutMs: 4321,
    },
    {
      args: ["usage", "summary", "--format", "json"],
      command: "qwencloud",
      providerID: "qwen",
      timeoutMs: 4321,
    },
  ])
  expect(usage).toMatchObject({
    id: "qwen",
    label: "Plus",
    windows: [
      {
        kind: "credits",
        label: "credits",
        quota: {
          current: 750,
          remainingPercent: 25,
          total: 1000,
          usedPercent: 75,
        },
      },
    ],
  })
  expect(usage.capturedAt).toBeGreaterThanOrEqual(before)
  expect(usage.capturedAt).toBeLessThanOrEqual(after)
  expect(usage.windows[0]?.resetsAt).toBe(Date.parse("2026-08-14T13:00:01.000Z"))
})

test("reports missing credentials when the CLI reports no authentication", async () => {
  const { calls, run } = createRun(JSON.stringify({ authenticated: false }))

  const error = await expectProviderError(
    fetchQwenTokenPlanUsage(undefined, {}, 4321, run)
  )

  expect(calls[0]?.acceptedExitCodes).toStrictEqual(new Set([2]))
  expect(error.kind).toBe("missing_credentials")
  expect(error.providerID).toBe("qwen")
  expect(calls).toHaveLength(1)
})

for (const [kind, auth, usage] of [
  ["auth", "{", ""],
  ["usage", authenticated, "{"],
  ["auth", "[]", ""],
] as const) {
  test(`classifies malformed ${kind} JSON as a safe decode error`, async () => {
    const { run } = createRun(auth, usage)

    const error = await expectProviderError(
      fetchQwenTokenPlanUsage(undefined, {}, 4321, run)
    )

    expect(error.kind).toBe("decode")
    expect(error.providerID).toBe("qwen")
  })
}

test("classifies a missing subscription as a safe decode error", async () => {
  const { run } = createRun(
    authenticated,
    JSON.stringify({ token_plan: { subscribed: false } })
  )

  const error = await expectProviderError(
    fetchQwenTokenPlanUsage(undefined, {}, 4321, run)
  )

  expect(error.kind).toBe("decode")
})

for (const [label, output] of [
  ["unwrapped payload", "[]"],
  ["missing token plan", "{}"],
  [
    "invalid usage percentage",
    JSON.stringify({ token_plan: { subscribed: true, usedPct: "75" } }),
  ],
] as const) {
  test(`rejects a ${label}`, async () => {
    const { run } = createRun(authenticated, output)

    const error = await expectProviderError(
      fetchQwenTokenPlanUsage(undefined, {}, 4321, run)
    )

    expect(error.kind).toBe("decode")
    expect(error.providerID).toBe("qwen")
  })
}

test("omits an invalid reset timestamp", async () => {
  const { run } = createRun(
    authenticated,
    JSON.stringify({
      token_plan: {
        resetDate: "not-a-date",
        subscribed: true,
        usedPct: 20,
      },
    })
  )

  const usage = await fetchQwenTokenPlanUsage(undefined, {}, 4321, run)

  expect(usage.windows[0]?.resetsAt).toBeNull()
})

test("accepts a token plan without optional string or count fields", async () => {
  const { run } = createRun(
    authenticated,
    JSON.stringify({ token_plan: { subscribed: true, usedPct: 15 } })
  )

  const usage = await fetchQwenTokenPlanUsage(undefined, {}, 4321, run)

  expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: 15 })
  expect(usage.label).toBe("Qwen Token Plan")
})

for (const [name, error] of [
  [
    "command failure",
    new ProviderError({
      kind: "command",
      message: "Provider command exited with code 1",
      providerID: "qwen",
    }),
  ],
  [
    "timeout",
    new ProviderError({
      kind: "timeout",
      message: "Provider command timed out",
      providerID: "qwen",
    }),
  ],
] as const) {
  test(`preserves safe ${name} classification`, async () => {
    const { run } = createRun(error)

    const raised = await expectProviderError(
      fetchQwenTokenPlanUsage(undefined, {}, 4321, run)
    )

    expect(raised.kind).toBe(error.kind)
    expect(raised.providerID).toBe("qwen")
  })
}

test("uses a configured provider label", async () => {
  const { run } = createRun(
    authenticated,
    JSON.stringify({
      token_plan: { planName: "Plus", subscribed: true, usedPct: 10 },
    })
  )

  const usage = await fetchQwenTokenPlanUsage({ label: "Work Qwen" }, {}, 4321, run)

  expect(usage.label).toBe("Work Qwen")
})

test("registers with the expected display metadata", () => {
  expect(qwenProvider).toMatchObject({
    defaultLabel: "Qwen",
    displayOrder: 4,
    footerWindowKind: "credits",
    id: "qwen",
    openCodeProviderIDs: ["bailian-token-plan-personal", "qwen"],
  })
})
