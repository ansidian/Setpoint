import {
  Timestamp,
  deserializeClock,
  getClock,
  makeClientId,
  makeClock,
  merkle,
  serializeClock,
  setClock,
} from "@actual-app/crdt";
import type { Client, InStatement, InValue, Row } from "@libsql/client";
import { serializeValue } from "./actualCrdtWire.ts";
import type { ActualSyncMessage } from "./actualCrdtWire.ts";
import { parseScheduleConditions } from "./scheduleMatchModel.ts";
import type { ActualSchedule } from "../../shared/types/actual.ts";

export type WriteValue = string | number | bigint | null | Uint8Array;
export type WriteFields = Record<string, WriteValue | undefined>;
interface ActualWriteBillData {
  account_id?: string | null;
  [key: string]: unknown;
}

export interface WriteQuery {
  sql: string;
  args: InValue[];
  messages: ActualSyncMessage[];
}
export type ResolvedRow = Record<string, InValue>;

export function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid Actual DB identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export async function tableColumns(client: Client, table: string): Promise<Set<string>> {
  const result = await client.execute(`PRAGMA table_info(${quoteIdent(table)})`);
  return new Set((result.rows || []).map((row) => String(row.name)));
}

export async function loadClock(client: Client): Promise<void> {
  const result = await client.execute("SELECT clock FROM messages_clock WHERE id = 1");
  const clockText = result.rows?.[0]?.clock;
  const clock = clockText
    ? deserializeClock(String(clockText))
    : makeClock(new Timestamp(0, 0, makeClientId()));
  setClock(clock);
}

export function makeMessages(dataset: string, row: string, fields: WriteFields): ActualSyncMessage[] {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([column, value]) => ({
      dataset,
      row,
      column,
      value: serializeValue(value),
      rawValue: value,
      timestamp: Timestamp.send(),
    }));
}

export function insertRowQuery(table: string, id: string, fields: WriteFields, columns: Set<string>): WriteQuery {
  const filtered = Object.fromEntries(
    Object.entries(fields).filter(([column, value]) => value !== undefined && value !== null && columns.has(column)),
  );
  const names = ["id", ...Object.keys(filtered)];
  return {
    sql: `INSERT INTO ${quoteIdent(table)} (${names.map(quoteIdent).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    args: [id, ...Object.values(filtered)] as InValue[],
    messages: makeMessages(table, id, filtered),
  };
}

export function updateRowQuery(table: string, id: string, fields: WriteFields, columns: Set<string>): WriteQuery | null {
  const filtered = Object.fromEntries(
    Object.entries(fields).filter(([column, value]) => value !== undefined && value !== null && columns.has(column)),
  );
  const names = Object.keys(filtered);
  if (!names.length) return null;
  return {
    sql: `UPDATE ${quoteIdent(table)} SET ${names.map((name) => `${quoteIdent(name)} = ?`).join(", ")} WHERE id = ?`,
    args: [...Object.values(filtered), id] as InValue[],
    messages: makeMessages(table, id, filtered),
  };
}

export function messageInsertQuery(message: ActualSyncMessage): InStatement {
  return {
    sql: `INSERT INTO messages_crdt (timestamp, dataset, row, column, value)
          VALUES (?, ?, ?, ?, ?)`,
    args: [String(message.timestamp), message.dataset, message.row, message.column, message.value],
  };
}

export function clockUpdateQuery(messages: ActualSyncMessage[]): InStatement {
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

export async function resolveAccount(client: Client, billData: ActualWriteBillData): Promise<Row> {
  const result = await client.execute(
    `SELECT id, name, type
     FROM accounts
     WHERE COALESCE(closed, 0) = 0 AND COALESCE(tombstone, 0) = 0
     ORDER BY name COLLATE NOCASE`,
  );
  const accounts = result.rows || [];
  if (billData.account_id) {
    const selected = accounts.find((account) => account.id === billData.account_id);
    if (selected) return selected;
    throw Object.assign(new Error("Selected Actual account was not found in the local cache"), { status: 400 });
  }
  const fallback = accounts.find((account) =>
    account.type === "checking" || String(account.name || "").toLowerCase().includes("checking"),
  ) || accounts[0];
  if (!fallback) throw Object.assign(new Error("No open Actual account was found in the local cache"), { status: 400 });
  return fallback;
}

export async function resolveAccountId(client: Client, accountId: string | null | undefined, label: string): Promise<Row> {
  if (!accountId) {
    throw Object.assign(new Error(`${label} is required`), { status: 400 });
  }
  const result = await client.execute({
    sql: `SELECT id, name, type
          FROM accounts
          WHERE id = ?
            AND COALESCE(closed, 0) = 0
            AND COALESCE(tombstone, 0) = 0
          LIMIT 1`,
    args: [accountId],
  });
  const account = result.rows?.[0];
  if (!account) {
    throw Object.assign(new Error(`${label} was not found in the local cache`), { status: 400 });
  }
  return account;
}

export async function resolvePayee(client: Client, payeeName: unknown): Promise<{ id: string; created: boolean; name: string }> {
  const name = String(payeeName || "").trim();
  if (!name) throw Object.assign(new Error("payee is required"), { status: 400 });
  const existing = await client.execute({
    sql: `SELECT id
          FROM payees
          WHERE LOWER(name) = LOWER(?)
            AND transfer_acct IS NULL
            AND COALESCE(tombstone, 0) = 0
          LIMIT 1`,
    args: [name],
  });
  const existingId = existing.rows?.[0]?.id;
  if (existingId) return { id: String(existingId), created: false, name };
  return { id: crypto.randomUUID(), created: true, name };
}

export async function resolveTransferPayee(client: Client, fromAccountId: string | null | undefined): Promise<ResolvedRow & { created: false }> {
  if (!fromAccountId) {
    throw Object.assign(new Error("Transfer requires from_account_id"), { status: 400 });
  }
  const result = await client.execute({
    sql: `SELECT id, name, transfer_acct
          FROM payees
          WHERE transfer_acct = ?
            AND COALESCE(tombstone, 0) = 0
          LIMIT 1`,
    args: [fromAccountId],
  });
  const payee = result.rows?.[0];
  if (!payee) {
    throw Object.assign(new Error("No transfer payee found for selected source account in the local cache"), {
      status: 400,
    });
  }
  return { ...Object.fromEntries(Object.entries(payee)), created: false } as ResolvedRow & { created: false };
}

export async function categoryExists(client: Client, categoryId: string | null | undefined): Promise<boolean> {
  if (!categoryId) return false;
  const result = await client.execute({
    sql: "SELECT id FROM categories WHERE id = ? AND COALESCE(tombstone, 0) = 0 LIMIT 1",
    args: [categoryId],
  });
  return Boolean(result.rows?.length);
}

export async function readMessagesSince(client: Client, since: string): Promise<ActualSyncMessage[]> {
  const result = await client.execute({
    sql: `SELECT timestamp, dataset, row, column, value
          FROM messages_crdt
          WHERE timestamp > ?
          ORDER BY timestamp ASC`,
    args: [since],
  });
  return result.rows.map((row) => ({
    timestamp: { toString: () => String(row.timestamp) },
    dataset: String(row.dataset),
    row: String(row.row),
    column: String(row.column),
    value: String(row.value),
  }));
}

export async function readSchedules(client: Client, scheduleColumns: Set<string>): Promise<Array<ActualSchedule & { rule?: string; next_date_id?: string }>> {
  const nameSelect = scheduleColumns.has("name") ? "s.name" : "NULL AS name";
  const result = await client.execute(
    `SELECT s.id, ${nameSelect}, s.rule, s.completed,
            r.conditions, r.actions, r.conditions_op, nd.id AS next_date_id
     FROM schedules s
     LEFT JOIN rules r ON r.id = s.rule
     LEFT JOIN schedules_next_date nd ON nd.schedule_id = s.id
     WHERE COALESCE(s.tombstone, 0) = 0`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name ? String(row.name) : null,
    rule: row.rule ? String(row.rule) : undefined,
    completed: Boolean(row.completed),
    next_date_id: row.next_date_id ? String(row.next_date_id) : undefined,
    conditions: parseScheduleConditions(row.conditions),
  }));
}
