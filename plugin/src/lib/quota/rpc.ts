// Thin adapter from the snapshot cache to an RPC handler, injectable for tests.

import { getQuotaSnapshot, type QuotaSnapshotOptions } from "./snapshot.js"
import type { QuotaView } from "./types.js"

/** Returns a zero-argument handler serving a fresh quota snapshot on every call. */
export function createQuotaHandler(options: QuotaSnapshotOptions = {}): () => Promise<QuotaView> {
  return () => getQuotaSnapshot(options)
}
