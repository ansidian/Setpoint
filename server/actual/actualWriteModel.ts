import { Timestamp } from "@actual-app/crdt";
import type { ActualBudgetMetadata } from "./actualSyncTransport.ts";

export function actualWriteDateInt(value: unknown): number {
  const date = Number(String(value || "").replace(/-/g, ""));
  if (!Number.isFinite(date) || date < 10000101 || date > 99991231) {
    throw Object.assign(new Error(`Invalid Actual date: ${JSON.stringify(value)}`), { status: 400 });
  }
  return date;
}

export function computeActualSyncSince(metadata: Partial<ActualBudgetMetadata>): string {
  // Push everything not known-synced. Epoch zero avoids dropping locally applied
  // messages when a freshly hydrated budget has no prior sync timestamp.
  return metadata.lastSyncedTimestamp
    || metadata.lastPushedTimestamp
    || new Timestamp(0, 0, "0").toString();
}
