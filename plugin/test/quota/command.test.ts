import { expect, test } from "bun:test"

import { runCommand } from "../../src/lib/quota/command.js"
import { ProviderError } from "../../src/lib/quota/errors.js"

const base = {
  command: "node",
  providerID: "codex" as const,
  timeoutMs: 5000,
  args: [] as string[],
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

test("runCommand returns trimmed stdout from a real process", async () => {
  const output = await runCommand({
    ...base,
    args: ["-e", "process.stdout.write('  hello  ')"],
  })

  expect(output).toBe("hello")
})

test("runCommand maps ENOENT to a missing_credentials error", async () => {
  const error = await expectProviderError(
    runCommand({
      command: `tally-does-not-exist-${crypto.randomUUID()}`,
      args: [],
      providerID: "codex",
      timeoutMs: 5000,
    })
  )

  expect(error.kind).toBe("missing_credentials")
  expect(error.providerID).toBe("codex")
})

test("runCommand rejects a non-zero exit as a command error", async () => {
  const error = await expectProviderError(
    runCommand({ ...base, args: ["-e", "process.exit(2)"] })
  )

  expect(error.kind).toBe("command")
  expect(error.providerID).toBe("codex")
})

test("runCommand accepts configured exit codes", async () => {
  const output = await runCommand({
    ...base,
    args: ["-e", "process.stdout.write('ok'); process.exit(2)"],
    acceptedExitCodes: new Set([2]),
  })

  expect(output).toBe("ok")
})

test("runCommand never includes stderr in the thrown message", async () => {
  const error = await expectProviderError(
    runCommand({
      ...base,
      args: ["-e", "process.stderr.write('LEAK_SECRET'); process.exit(1)"],
    })
  )

  expect(error.kind).toBe("command")
  expect(error.message).not.toContain("LEAK_SECRET")
})

test("runCommand kills a command that exceeds its timeout", async () => {
  const error = await expectProviderError(
    runCommand({
      command: "sleep",
      args: ["5"],
      providerID: "codex",
      timeoutMs: 40,
    })
  )

  expect(error.kind).toBe("timeout")
})

test("runCommand rejects oversized stdout instead of buffering it", async () => {
  const error = await expectProviderError(
    runCommand({
      ...base,
      args: ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1))"],
    })
  )

  expect(error.kind).toBe("command")
})
