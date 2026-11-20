// Bounded, interruptible subprocess execution for providers that shell out.
// stderr is counted but never copied into an error message.

import { spawn } from "node:child_process"

import { ProviderError } from "./errors.js"
import type { ProviderErrorKind, ProviderID } from "./types.js"

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

export interface RunCommandInput {
  readonly command: string
  readonly args: readonly string[]
  readonly providerID: ProviderID
  readonly timeoutMs: number
  readonly acceptedExitCodes?: ReadonlySet<number>
}

/**
 * Runs a subprocess without a shell, capping stdout at 2 MiB and killing it on
 * timeout. Failures are typed ProviderErrors carrying no process output.
 */
export function runCommand(input: RunCommandInput): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const fail = (
      message: string,
      cause?: unknown,
      kind: ProviderErrorKind = "command"
    ): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      child.kill()
      reject(
        new ProviderError({
          kind,
          message,
          providerID: input.providerID,
          cause,
        })
      )
    }

    timer = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill()
      reject(
        new ProviderError({
          kind: "timeout",
          message: "Provider command timed out",
          providerID: input.providerID,
        })
      )
    }, input.timeoutMs)

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength

      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        fail("Provider command produced too much output")
        return
      }

      stdout.push(chunk)
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength

      if (stderrBytes > MAX_OUTPUT_BYTES) {
        fail("Provider command produced too much output")
      }
    })

    child.once("error", (error) => {
      const notFound = (error as NodeJS.ErrnoException).code === "ENOENT"
      fail(
        notFound
          ? "Provider command executable was not found"
          : "Provider command could not be started",
        undefined,
        notFound ? "missing_credentials" : "command"
      )
    })

    child.once("close", (code) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)

      const exitCode = code ?? -1

      if (exitCode === 0 || input.acceptedExitCodes?.has(exitCode) === true) {
        resolve(Buffer.concat(stdout).toString("utf8").trim())
        return
      }

      reject(
        new ProviderError({
          kind: "command",
          message: `Provider command exited with code ${exitCode}`,
          providerID: input.providerID,
        })
      )
    })
  })
}
