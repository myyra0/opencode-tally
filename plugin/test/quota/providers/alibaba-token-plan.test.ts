// Alibaba Token Plan adapter tests. The injected command runner replaces a real executor,
// so no fake executable is needed.

import { expect, test } from "bun:test"

import type { RunCommandInput } from "../../../src/lib/quota/command.js"
import { ProviderError } from "../../../src/lib/quota/errors.js"
import {
  alibabaTokenPlanProvider,
  fetchAlibabaTokenPlanUsage,
} from "../../../src/lib/quota/providers/alibaba-token-plan.js"

type CommandResult = string | ProviderError

function createRun(output: CommandResult, version = "bl 1.15.0") {
  const calls: RunCommandInput[] = []
  const run = (input: RunCommandInput): Promise<string> => {
    calls.push(input)
    const result = calls.length === 1 ? version : output
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

test("normalizes fractions, millisecond resets and both quota windows", async () => {
  const reset = Date.parse("2026-09-10T12:00:00Z")
  const { calls, run } = createRun(
    JSON.stringify({
      per1WeekPercentage: 1,
      per1WeekResetTime: reset + 604_800_000,
      per5HourPercentage: 0.42,
      per5HourResetTime: reset,
    })
  )

  const usage = await fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)

  expect({
    id: usage.id,
    label: usage.label,
    quotas: usage.windows.map((window) => window.quota),
    reset: usage.windows[0]?.resetsAt,
    secondWindowKind: usage.windows[1]?.kind,
  }).toMatchObject({
    id: "alibaba-token-plan",
    label: "Alibaba Token Plan",
    quotas: [
      { _tag: "Percentage", remainingPercent: 58, usedPercent: 42 },
      { _tag: "Percentage", remainingPercent: 0, usedPercent: 100 },
    ],
    reset,
    secondWindowKind: "weekly",
  })
  expect(calls).toStrictEqual([
    {
      args: ["--version"],
      command: "bl",
      providerID: "alibaba-token-plan",
      timeoutMs: 4321,
    },
    {
      args: [
        "usage",
        "token-plan",
        "--console-region",
        "ap-southeast-1",
        "--console-site",
        "international",
        "--output",
        "json",
      ],
      command: "bl",
      providerID: "alibaba-token-plan",
      timeoutMs: 4321,
    },
  ])
})

test("supports China, labels, zero usage and a missing window", async () => {
  const { calls, run } = createRun('{"per1WeekPercentage":0}')

  const usage = await fetchAlibabaTokenPlanUsage(
    { label: "Solo", region: "china" },
    {},
    4321,
    run
  )

  expect(usage.label).toBe("Solo")
  expect(usage.windows).toHaveLength(1)
  expect(usage.windows[0]).toMatchObject({
    kind: "weekly",
    quota: { usedPercent: 0 },
    resetsAt: null,
  })
  expect(calls[1]?.args).toContain("cn-beijing")
  expect(calls[1]?.args).toContain("domestic")
})

for (const reset of [null, false, "2026-09-10", -1, 0, 1e30]) {
  test(`does not invent a reset from ${String(reset)}`, async () => {
    const { run } = createRun(
      JSON.stringify({
        per1WeekPercentage: null,
        per5HourPercentage: 0.5,
        per5HourResetTime: reset,
      })
    )

    const usage = await fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)

    expect(usage.windows[0]?.resetsAt).toBeNull()
  })
}

for (const payload of [
  "not JSON",
  "null",
  "[]",
  "{}",
  '{"success":false}',
  '{"per5HourPercentage":true}',
  '{"per5HourPercentage":"0.5"}',
  '{"per5HourPercentage":-0.1}',
  '{"per5HourPercentage":1.1}',
  '{"per5HourPercentage":1e400}',
]) {
  test(`rejects missing or invalid quota: ${payload}`, async () => {
    const { run } = createRun(payload)

    const error = await expectProviderError(
      fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)
    )

    expect(error.kind).toBe("decode")
    expect(error.providerID).toBe("alibaba-token-plan")
  })
}

test("preserves bounded runtime command errors and timeouts", async () => {
  for (const error of [
    new ProviderError({
      kind: "command",
      message: "Provider command could not be started",
      providerID: "alibaba-token-plan",
    }),
    new ProviderError({
      kind: "timeout",
      message: "Provider command timed out",
      providerID: "alibaba-token-plan",
    }),
  ]) {
    const raised = await expectProviderError(
      fetchAlibabaTokenPlanUsage(undefined, {}, 4321, createRun(error).run)
    )
    expect(raised.kind).toBe(error.kind)
    expect(raised.providerID).toBe("alibaba-token-plan")
  }
})

test("rejects an unsupported Bailian CLI version with an upgrade diagnostic", async () => {
  const { run } = createRun('{"per1WeekPercentage":0}', "bl version 1.14.3")

  const error = await expectProviderError(
    fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)
  )

  expect(error.message).toContain("Bailian CLI >= 1.15.0 is required")
})

test("checks the Bailian version instead of an unrelated runtime version", async () => {
  const { run } = createRun(
    '{"per1WeekPercentage":0}',
    "node v20.11.0\nbl version 1.14.3"
  )

  const error = await expectProviderError(
    fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)
  )

  expect(error.message).toContain("Bailian CLI >= 1.15.0 is required")
})

test("supports the scoped package version banner", async () => {
  const { calls, run } = createRun(
    '{"per1WeekPercentage":0}',
    "@bailian/cli/1.15.0 darwin-arm64 node-v20.11.0"
  )

  const usage = await fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)

  expect(usage.id).toBe("alibaba-token-plan")
  expect(calls).toHaveLength(2)
})

test("reports an unparseable Bailian version separately", async () => {
  const { run } = createRun('{"per1WeekPercentage":0}', "Bailian CLI")

  const error = await expectProviderError(
    fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)
  )

  expect(error.kind).toBe("decode")
  expect(error.message).toContain("Bailian CLI version could not be parsed")
})

test("registers with the expected display metadata", () => {
  expect(alibabaTokenPlanProvider).toMatchObject({
    defaultLabel: "Alibaba Token Plan",
    displayOrder: 7,
    footerWindowKind: "rolling",
    id: "alibaba-token-plan",
    openCodeProviderIDs: ["alibaba", "alibaba-cn", "alibaba-token-plan"],
  })
})

test("reads the CLI 2.x monthly window", async () => {
  const reset = Date.parse("2026-12-01T00:00:00Z")
  const { run } = createRun(
    JSON.stringify({
      hasQuotaData: true,
      per1MonthPercentage: 0.47,
      per1MonthResetTime: reset,
    })
  )

  const usage = await fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)

  expect(usage.windows).toStrictEqual([
    {
      kind: "monthly",
      label: "monthly",
      quota: { _tag: "Percentage", remainingPercent: 53, usedPercent: 47 },
      resetsAt: reset,
    },
  ])
})

test("orders every dynamic window by duration", async () => {
  const { run } = createRun(
    JSON.stringify({
      hasQuotaData: true,
      per5HourPercentage: 0.1,
      per1DayPercentage: 0.2,
      per1WeekPercentage: 0.3,
      per1MonthPercentage: 0.4,
    })
  )

  const usage = await fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)

  expect(usage.windows.map((window) => [window.kind, window.label])).toStrictEqual([
    ["rolling", "5h"],
    ["daily", "daily"],
    ["weekly", "weekly"],
    ["monthly", "monthly"],
  ])
  expect(usage.windows.map((window) => window.quota)).toMatchObject([
    { usedPercent: 10 },
    { usedPercent: 20 },
    { usedPercent: 30 },
    { usedPercent: 40 },
  ])
})

test("shows an unknown monthly window when the CLI reports no quota data", async () => {
  const { run } = createRun('{"hasQuotaData":false}')

  const usage = await fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)

  expect(usage.windows).toStrictEqual([
    { kind: "monthly", label: "monthly", quota: { _tag: "Unknown" }, resetsAt: null },
  ])
})

test("keeps an unrecognized window shape instead of dropping it", async () => {
  const { run } = createRun('{"hasQuotaData":true,"per2HourPercentage":0.5}')

  const usage = await fetchAlibabaTokenPlanUsage(undefined, {}, 4321, run)

  expect(usage.windows[0]).toMatchObject({ kind: "other", label: "2h" })
})
