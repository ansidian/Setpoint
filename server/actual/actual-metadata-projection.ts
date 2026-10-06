import db from "../db/connection.ts";
import { syncActualMetadata } from "./actual.ts";
import { readLocalActualMetadata } from "./actual-local-metadata.ts";
import type { InStatement } from "@libsql/client";
import type { ActualMetadata } from "../../shared/types/actual.ts";

type ActualMetadataInput = Partial<ActualMetadata>;
export interface ActualMetadataProjectionDb {
  execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }>;
}
export interface ActualMetadataSyncHealth {
  state: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}
type ProjectedActualMetadata = ActualMetadata & { syncHealth: ActualMetadataSyncHealth };

function safeJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function metadataWithPayeeMap(metadata: ActualMetadataInput = {}): ActualMetadata {
  const payees = Array.isArray(metadata.payees) ? metadata.payees : [];
  return {
    accounts: Array.isArray(metadata.accounts) ? metadata.accounts : [],
    payees,
    payeeMap: metadata.payeeMap || Object.fromEntries(payees.map((payee) => [payee.id, payee.name])),
    categories: Array.isArray(metadata.categories) ? metadata.categories : [],
    schedules: Array.isArray(metadata.schedules) ? metadata.schedules : [],
    recentTransactions: Array.isArray(metadata.recentTransactions) ? metadata.recentTransactions : [],
  };
}

function metadataFromRow(row: Record<string, unknown> | null): ProjectedActualMetadata | null {
  if (!row) return null;
  const metadata = metadataWithPayeeMap({
    accounts: safeJson(row.accounts_json, []),
    payees: safeJson(row.payees_json, []),
    categories: safeJson(row.categories_json, []),
    schedules: safeJson(row.schedules_json, []),
    recentTransactions: safeJson(row.recent_transactions_json, []),
  });
  return {
    ...metadata,
    syncHealth: {
      state: String(row.status || "needs_sync"),
      lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
      lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
      lastError: row.last_error ? String(row.last_error) : null,
    },
  };
}

export function hasActualMetadataRows(metadata: ActualMetadataInput = {}): boolean {
  return Boolean(
    metadata.accounts?.length
    || metadata.payees?.length
    || metadata.categories?.length
    || metadata.schedules?.length
  );
}

export async function loadActualMetadataForProjection(userId: string, {
  refreshLocal = true,
  preferFreshLocal = false,
}: { refreshLocal?: boolean; preferFreshLocal?: boolean } = {}): Promise<ActualMetadata> {
  if (!preferFreshLocal || !refreshLocal) {
    try {
      return await readLocalActualMetadata(userId, { localOnly: true });
    } catch (error) {
      if (!refreshLocal) throw error;
    }
  }
  return syncActualMetadata(userId);
}

function metadataProjectionArgs(userId: string, metadata: ActualMetadataInput, timestamp: string): Array<string> {
  const normalized = metadataWithPayeeMap(metadata);
  return [
    userId,
    JSON.stringify(normalized.accounts),
    JSON.stringify(normalized.payees),
    JSON.stringify(normalized.categories),
    JSON.stringify(normalized.schedules),
    JSON.stringify(normalized.recentTransactions),
    timestamp,
    timestamp,
    timestamp,
  ];
}

export function upsertMetadataProjectionQuery(userId: string, metadata: ActualMetadataInput, timestamp: string): { sql: string; args: string[] } {
  return {
    sql: `INSERT INTO ea_actual_metadata_mirror
            (user_id, status, accounts_json, payees_json, categories_json,
             schedules_json, recent_transactions_json, last_success_at,
             last_attempt_at, last_error, updated_at)
          VALUES (?, 'current', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            status = 'current',
            accounts_json = excluded.accounts_json,
            payees_json = excluded.payees_json,
            categories_json = excluded.categories_json,
            schedules_json = excluded.schedules_json,
            recent_transactions_json = excluded.recent_transactions_json,
            last_success_at = excluded.last_success_at,
            last_attempt_at = excluded.last_attempt_at,
            last_error = NULL,
            updated_at = excluded.updated_at`,
    args: metadataProjectionArgs(userId, metadata, timestamp),
  };
}

export async function readActualMetadataProjection(userId: string, { dbClient = db }: { dbClient?: ActualMetadataProjectionDb } = {}): Promise<ProjectedActualMetadata | null> {
  const result = await dbClient.execute({
    sql: `SELECT status, accounts_json, payees_json, categories_json, schedules_json,
                 recent_transactions_json, last_success_at, last_attempt_at, last_error
          FROM ea_actual_metadata_mirror
          WHERE user_id = ?`,
    args: [userId],
  });
  return metadataFromRow(result.rows?.[0] || null);
}
