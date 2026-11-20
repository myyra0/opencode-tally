// Shared fetch mock for provider-adapter tests.

import { afterEach } from "bun:test"

const originalFetch = globalThis.fetch

export type FetchCall = [url: string | URL | Request, init?: RequestInit]

export interface FetchMock {
  calls: FetchCall[]
}

/** Replaces globalThis.fetch with a resolver for `response` and records every call. */
export function installFetchMock(response: Response): FetchMock {
  const calls: FetchCall[] = []
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push([url, init])
    return Promise.resolve(response)
  }) as typeof fetch
  return { calls }
}

/** Replaces globalThis.fetch with a sequential response queue and records every call. */
export function installFetchResponses(responses: readonly Response[]): FetchMock {
  const calls: FetchCall[] = []
  let index = 0
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push([url, init])
    const response = responses[index]
    index += 1
    if (!response) throw new Error("Unexpected provider request")
    return Promise.resolve(response)
  }) as typeof fetch
  return { calls }
}

/** Restores the real fetch. Registered once so every importing test file is cleaned up. */
export function resetFetchMock(): void {
  globalThis.fetch = originalFetch
}

afterEach(resetFetchMock)
