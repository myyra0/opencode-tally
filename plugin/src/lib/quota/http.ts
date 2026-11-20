// Bounded, interruptible JSON transport for provider requests.
// Failures carry only static, safe messages.

import { ProviderError } from "./errors.js"
import type { ProviderErrorInput } from "./errors.js"
import type { ProviderErrorKind, ProviderID } from "./types.js"

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export interface RequestJsonInput {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly method: "GET"
  readonly providerID: ProviderID
  readonly timeoutMs: number
}

/** Internal marker so abort-driven failures are distinguishable from network errors. */
class TimeoutSignal extends Error {}

async function withAbort<T>(
  work: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    throw new TimeoutSignal()
  }

  let rejectAborted: (reason: unknown) => void = () => undefined
  const onAbort = () => rejectAborted(new TimeoutSignal())
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject
    signal.addEventListener("abort", onAbort, { once: true })
  })

  try {
    return await Promise.race([work, aborted])
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cancellation is best effort once a response may already be complete.
  }
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")

  if (raw === null) {
    return undefined
  }

  const seconds = Number(raw.trim())

  return Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : undefined
}

/** Reads at most 2 MiB, canceling the stream as soon as the limit is exceeded. */
async function readBoundedBody(
  response: Response,
  signal: AbortSignal
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"))

  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await cancelBody(response)
    throw new RangeError("response limit exceeded")
  }

  if (!response.body) {
    return new Uint8Array()
  }

  const reader = response.body.getReader()
  const cancel = (): Promise<void> => reader.cancel().catch(() => undefined)
  const onAbort = () => {
    void cancel()
  }
  signal.addEventListener("abort", onAbort, { once: true })

  const chunks: Uint8Array[] = []
  let length = 0

  try {
    while (true) {
      const result = await reader.read()

      if (result.done) {
        break
      }

      length += result.value.byteLength

      if (length > MAX_RESPONSE_BYTES) {
        await cancel()
        throw new RangeError("response limit exceeded")
      }

      chunks.push(result.value)
    }
  } finally {
    signal.removeEventListener("abort", onAbort)
  }

  const body = new Uint8Array(length)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

/**
 * Performs a timed GET request and decodes its JSON body. Every failure is a
 * typed ProviderError; response text never appears in the thrown message.
 */
export async function requestJson(input: RequestJsonInput): Promise<unknown> {
  const signal = AbortSignal.timeout(input.timeoutMs)
  const fail = (
    kind: ProviderErrorKind,
    message: string,
    extra: Pick<ProviderErrorInput, "status" | "retryAfterMs"> = {}
  ): ProviderError =>
    new ProviderError({ kind, message, providerID: input.providerID, ...extra })

  try {
    return await withAbort(
      (async () => {
        const response = await globalThis.fetch(input.url, {
          headers: { ...input.headers },
          method: input.method,
          signal,
        })

        if (response.status === 429) {
          await cancelBody(response)
          throw fail("rate_limit", "Provider rate limit reached", {
            status: response.status,
            retryAfterMs: retryAfterMs(response),
          })
        }

        if (!response.ok) {
          await cancelBody(response)
          throw fail(
            "transport",
            `Provider request failed with status ${response.status}`,
            { status: response.status }
          )
        }

        const body = await readBoundedBody(response, signal)

        try {
          return JSON.parse(new TextDecoder().decode(body))
        } catch {
          throw fail("decode", "Provider response could not be decoded")
        }
      })(),
      signal
    )
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error
    }

    if (error instanceof TimeoutSignal || signal.aborted) {
      throw fail("timeout", "Provider request timed out")
    }

    if (error instanceof RangeError) {
      throw fail("decode", "Provider response exceeded the size limit")
    }

    throw fail("transport", "Provider request failed")
  }
}
