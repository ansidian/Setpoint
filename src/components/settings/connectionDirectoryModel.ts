import { CONNECTIONS } from "./connectionModel";
import type { ConnectionId, ConnectionState } from "./connectionModel";

const CONNECTION_IDS = new Set<ConnectionId>(CONNECTIONS.map(({ id }) => id));

const LEGACY_HASH_ALIASES: Readonly<Record<string, ConnectionId>> = {
  "todoist-setup": "todoist",
  "actual-budget-connection": "actual-budget",
  "discord-reminders": "discord-reminders",
  "gmail-realtime-delivery": "google-workspace",
};

export function connectionIdFromHash(hash: string): ConnectionId | null {
  const value = decodeURIComponent(hash.replace(/^#/, ""));
  if (CONNECTION_IDS.has(value as ConnectionId)) return value as ConnectionId;
  return LEGACY_HASH_ALIASES[value] ?? null;
}

export function connectionSummary(rows: ReadonlyArray<{ state: ConnectionState | null }>) {
  return rows.reduce((summary, row) => {
    if (row.state === "connected") summary.connected += 1;
    if (row.state === "needs_setup") summary.setup += 1;
    if (row.state === "needs_attention") summary.attention += 1;
    return summary;
  }, { connected: 0, setup: 0, attention: 0 });
}

export function connectionActionLabel(state: ConnectionState | null): "Connect" | "Manage" | "Repair" {
  if (state === "connected") return "Manage";
  if (state === "needs_attention") return "Repair";
  return "Connect";
}
