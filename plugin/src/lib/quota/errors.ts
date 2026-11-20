// Typed boundary errors for provider adapters. Messages are static and user-facing;
// response bodies, command stderr, and credential values never reach them.

import type { ProviderErrorKind, ProviderID } from "./types.js"

export interface ProviderErrorInput {
  readonly kind: ProviderErrorKind
  readonly providerID: ProviderID
  readonly message: string
  readonly status?: number
  readonly retryAfterMs?: number
  readonly cause?: unknown
}

/** A provider failure whose kind drives the sidebar's error behavior. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly providerID: ProviderID
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(input: ProviderErrorInput) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause }
    )
    this.name = "ProviderError"
    this.kind = input.kind
    this.providerID = input.providerID
    this.status = input.status
    this.retryAfterMs = input.retryAfterMs
  }
}
