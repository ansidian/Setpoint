// Lightweight Actual metadata sync engine: HTTP login + file download + the
// protobuf sync POST, plus the CRDT-message application that mutates the on-disk
// db.sqlite and the @actual-app/crdt process-global clock. The clock read-modify-
// write (loadClock -> postActualSync -> applySyncMessages) is serialized by the
// caller (syncDownloadedBudget) under withActualClockLock; transport + wire + db
// apply stay one cohesive engine because they share that global clock.
import { createClient } from "@libsql/client";
import type { Client, InStatement, InValue } from "@libsql/client";
import {
  MessageSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  Timestamp,
  create,
  deserializeClock,
  fromBinary,
  makeClientId,
  makeClock,
  merkle,
  serializeClock,
  setClock,
  getClock,
  toBinary,
} from "@actual-app/crdt";
import { writeFile } from "fs/promises";
import path from "path";
import { withActualClockLock } from "./actual-clock-lock.ts";
import type { ActualConfig } from "../../shared/types/actual.ts";

interface FetchActualOptions {
  token?: string | null;
  fileId?: string | null;
  body?: unknown;
}

interface ActualBudgetMetadata {
  id?: string;
  groupId: string;
  cloudFileId: string;
  lastSyncedTimestamp?: string;
  [key: string]: unknown;
}

interface MetadataSyncMessage {
  timestamp: Timestamp;
  dataset: string;
  row: string;
  column: string;
  value: string;
  rawValue?: InValue;
}

interface DecodedSyncResponse {
  messages: MetadataSyncMessage[];
  merkle: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function timeoutMs(): number {
  const value = Number(process.env.EA_ACTUAL_LIGHTWEIGHT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

export async function fetchActualJson<T = unknown>(url: string, { token = null, fileId = null, body = null }: FetchActualOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let text = "";
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-ACTUAL-TOKEN": token } : {}),
        ...(fileId ? { "X-ACTUAL-FILE-ID": fileId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    text = await response.text();
  } catch (err: unknown) {
    throw Object.assign(new Error(err instanceof Error && err.name === "AbortError"
      ? "Actual Budget lightweight metadata request timed out"
      : "Actual Budget server is unreachable"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    throw Object.assign(new Error(`Actual Budget returned non-JSON response: ${text.slice(0, 120)}`), { status: 502 });
  }
}

export async function fetchActualBuffer(url: string, { token, fileId }: { token: string; fileId: string }): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "X-ACTUAL-TOKEN": token,
        "X-ACTUAL-FILE-ID": fileId,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Object.assign(new Error(`Actual Budget file download failed: ${text.slice(0, 120) || response.status}`), {
        status: response.status >= 500 ? 502 : 400,
      });
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function loginActual(config: ActualConfig): Promise<string> {
  if (!config.password) {
    throw Object.assign(new Error("Actual Budget password is required for lightweight metadata download"), { status: 400 });
  }
  const login = await fetchActualJson<{ data?: { token?: string } }>(`${config.serverURL}/account/login`, {
    body: { password: config.password, loginMethod: "password" },
  });
  const token = login?.data?.token;
  if (!token) throw Object.assign(new Error("Actual Budget login did not return a session token"), { status: 502 });
  return token;
}

export function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid Actual DB identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function tableColumns(client: Client, table: string): Promise<Set<string>> {
  const result = await client.execute(`PRAGMA table_info(${quoteIdent(table)})`);
  return new Set((result.rows || []).map((row) => String(row.name)));
}

export function deserializeSyncValue(value: unknown): InValue {
  const text = String(value ?? "");
  switch (text[0]) {
    case "0":
      return null;
    case "N":
      return Number.parseFloat(text.slice(2));
    case "S":
      return text.slice(2);
    default:
      throw new Error(`Invalid Actual sync value: ${text.slice(0, 20)}`);
  }
}

export function encodeSyncRequest({ groupId, cloudFileId, since }: { groupId: string; cloudFileId: string; since: string | Timestamp }): Uint8Array {
  const requestPb = create(SyncRequestSchema, {
    groupId,
    fileId: cloudFileId,
    since: String(since),
  });
  return toBinary(SyncRequestSchema, requestPb);
}

export function decodeSyncResponse(buffer: ArrayBuffer | Uint8Array): DecodedSyncResponse {
  const responsePb = fromBinary(SyncResponseSchema, new Uint8Array(buffer));
  const messages = responsePb.messages.map((envelopePb: { isEncrypted: boolean; content: Uint8Array; timestamp: string }) => {
    if (envelopePb.isEncrypted) {
      throw Object.assign(new Error("Encrypted Actual sync messages are not supported by lightweight metadata refresh"), {
        status: 400,
      });
    }
    const messagePb = fromBinary(MessageSchema, envelopePb.content);
    return {
      timestamp: Timestamp.parse(envelopePb.timestamp),
      dataset: messagePb.dataset,
      row: messagePb.row,
      column: messagePb.column,
      value: messagePb.value,
      rawValue: deserializeSyncValue(messagePb.value),
    };
  });
  const merkleText = responsePb.merkle;
  return {
    messages,
    merkle: merkleText ? JSON.parse(merkleText) : null,
  };
}

async function postActualSync(config: ActualConfig, token: string, { metadata, since }: { metadata: ActualBudgetMetadata; since: string }): Promise<DecodedSyncResponse> {
  const buffer = encodeSyncRequest({
    groupId: metadata.groupId,
    cloudFileId: metadata.cloudFileId,
    since,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${config.serverURL}/sync/sync`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Length": String(buffer.length),
        "Content-Type": "application/actual-sync",
        "X-ACTUAL-TOKEN": token,
      },
      body: buffer,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Object.assign(new Error(`Actual Budget lightweight sync failed: ${text.slice(0, 120) || response.status}`), {
        status: response.status >= 500 ? 502 : 400,
      });
    }
    return decodeSyncResponse(await response.arrayBuffer());
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "status" in err) throw err;
    throw Object.assign(new Error(err instanceof Error && err.name === "AbortError"
      ? "Actual Budget lightweight sync timed out"
      : "Actual Budget lightweight sync failed"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function loadClock(client: Client): Promise<void> {
  try {
    const result = await client.execute("SELECT clock FROM messages_clock WHERE id = 1");
    const clockText = result.rows?.[0]?.clock;
    setClock(clockText
      ? deserializeClock(String(clockText))
      : makeClock(new Timestamp(0, 0, makeClientId())));
  } catch {
    setClock(makeClock(new Timestamp(0, 0, makeClientId())));
  }
}

function clockUpdateQuery(messages: MetadataSyncMessage[]): InStatement {
  let currentMerkle = getClock().merkle;
  for (const message of messages) {
    currentMerkle = merkle.insert(currentMerkle, message.timestamp);
  }
  currentMerkle = merkle.prune(currentMerkle);
  const nextClock = { ...getClock(), merkle: currentMerkle };
  setClock(nextClock);
  return {
    sql: "INSERT OR REPLACE INTO messages_clock (id, clock) VALUES (1, ?)",
    args: [serializeClock(nextClock)],
  };
}

async function latestLocalMessageTimestamp(client: Client): Promise<string | null> {
  try {
    const result = await client.execute("SELECT MAX(timestamp) AS timestamp FROM messages_crdt");
    return result.rows?.[0]?.timestamp ? String(result.rows[0].timestamp) : null;
  } catch {
    return null;
  }
}

async function shouldApplySyncMessage(client: Client, message: MetadataSyncMessage): Promise<boolean> {
  const result = await client.execute({
    sql: `SELECT timestamp
          FROM messages_crdt
          WHERE dataset = ?
            AND row = ?
            AND column = ?
            AND timestamp >= ?
          ORDER BY timestamp ASC
          LIMIT 1`,
    args: [message.dataset, message.row, message.column, String(message.timestamp)],
  });
  return !result.rows?.length;
}

export function messageInsertQuery(message: MetadataSyncMessage): { sql: string; args: InValue[] } {
  return {
    sql: `INSERT OR IGNORE INTO messages_crdt (timestamp, dataset, row, column, value)
          VALUES (?, ?, ?, ?, ?)`,
    args: [String(message.timestamp), message.dataset, message.row, message.column, message.value],
  };
}

async function applySyncMessages(client: Client, messages: MetadataSyncMessage[]): Promise<{ applied: number; recorded: number }> {
  const sorted = [...messages].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  // Hoist PRAGMA table_info to one probe per distinct dataset (P2-17) instead of
  // re-running it for every message.
  const datasets = [...new Set(sorted.map((m) => m.dataset).filter((d) => d !== "prefs"))];
  const columnsByDataset = new Map<string, Set<string>>(
    await Promise.all(datasets.map(async (dataset): Promise<[string, Set<string>]> => [dataset, await tableColumns(client, dataset)])),
  );
  const applied: MetadataSyncMessage[] = [];
  const clockMessages: MetadataSyncMessage[] = [];
  for (const message of sorted) {
    if (message.dataset === "prefs") continue;
    const columns = columnsByDataset.get(message.dataset);
    if (!columns || !columns.has("id") || !columns.has(message.column)) continue;

    const applyMessage = await shouldApplySyncMessage(client, message);
    if (applyMessage) {
      const existing = await client.execute({
        sql: `SELECT id FROM ${quoteIdent(message.dataset)} WHERE id = ? LIMIT 1`,
        args: [message.row],
      });
      if (existing.rows?.length) {
        await client.execute({
          sql: `UPDATE ${quoteIdent(message.dataset)} SET ${quoteIdent(message.column)} = ? WHERE id = ?`,
          args: [message.rawValue ?? null, message.row],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO ${quoteIdent(message.dataset)} (id, ${quoteIdent(message.column)}) VALUES (?, ?)`,
          args: [message.row, message.rawValue ?? null],
        });
      }
      applied.push(message);
    }

    // INSERT OR IGNORE no-ops on the UNIQUE messages_crdt.timestamp; rowsAffected
    // tells us whether the message was newly recorded, replacing the redundant
    // hasSyncMessageTimestamp SELECT probe (P2-17). Identical clock semantics.
    const inserted = await client.execute(messageInsertQuery(message));
    if (inserted.rowsAffected > 0) clockMessages.push(message);
  }
  if (clockMessages.length) await client.execute(clockUpdateQuery(clockMessages));
  return { applied: applied.length, recorded: clockMessages.length };
}

export async function syncDownloadedBudget(config: ActualConfig, token: string, { budgetDir, metadata }: { budgetDir: string; metadata: ActualBudgetMetadata }) {
  const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
  try {
    // Serialize the global-clock read-modify-write (loadClock -> postActualSync
    // -> applySyncMessages/clockUpdateQuery) against the lightweight bill-write
    // path, which mutates the same @actual-app/crdt process-global clock. The
    // network sync sits inside the lock because the clock is "held" in the
    // global across it; a concurrent loadClock would otherwise clobber it (P1-4).
    const { syncResult, applyResult, since } = await withActualClockLock(async () => {
      await loadClock(client);
      const sinceTimestamp = metadata.lastSyncedTimestamp
        || await latestLocalMessageTimestamp(client)
        || new Timestamp(Date.now() - 5 * 60 * 1000, 0, "0").toString();
      const sync = await postActualSync(config, token, { metadata, since: sinceTimestamp });
      const apply = await applySyncMessages(client, sync.messages);
      return { syncResult: sync, applyResult: apply, since: sinceTimestamp };
    });
    const latestRemoteTimestamp = syncResult.messages
      .map((message) => String(message.timestamp))
      .sort()
      .at(-1);
    const nextMetadata = latestRemoteTimestamp
      ? { ...metadata, lastSyncedTimestamp: latestRemoteTimestamp }
      : metadata;
    if (latestRemoteTimestamp) {
      await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify(nextMetadata));
    }
    return {
      ...syncResult,
      ...applyResult,
      metadata: nextMetadata,
      since,
    };
  } finally {
    await client.close();
  }
}
