import db from "../db/connection.ts";
import { getMetadata as actualGetMetadata } from "./actual.ts";
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

export const EMPTY_ACTUAL_METADATA: ActualMetadata = {
  accounts: [],
  payees: [],
  payeeMap: {},
  categories: [],
  schedules: [],
  recentTransactions: [],
};

function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}

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
  allowWorkerFallback = true,
  preferFreshLocal = false,
}: { refreshLocal?: boolean; allowWorkerFallback?: boolean; preferFreshLocal?: boolean } = {}): Promise<ActualMetadata> {
  let localError: unknown = null;
  if (!preferFreshLocal) {
    try {
      return await readLocalActualMetadata(userId, {
        refresh: false,
        localOnly: true,
      });
    } catch (err: unknown) {
      localError = err;
      console.warn("[EA] Cached Actual metadata projection failed:", err instanceof Error ? err.message : err);
    }
  }

  let projectionError: unknown = null;
  if (refreshLocal) {
    try {
      return await readLocalActualMetadata(userId, {
        refresh: true,
      });
    } catch (err: unknown) {
      projectionError = err;
      console.warn("[EA] Lightweight Actual metadata projection failed:", err instanceof Error ? err.message : err);
    }
  }
  if (!allowWorkerFallback) throw projectionError || localError;
  console.warn("[EA] Falling back to Actual worker metadata projection:", projectionError instanceof Error ? projectionError.message : localError instanceof Error ? localError.message : null);
  return actualGetMetadata(userId, { forceWorker: true, forceRefresh: refreshLocal });
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

function metadataUnavailableError(projected: ProjectedActualMetadata | null): Error & { status: number } {
  const detail = projected?.syncHealth?.lastError ? `: ${projected.syncHealth.lastError}` : "";
  return Object.assign(new Error(`Actual metadata projection is unavailable${detail}`), { status: 503 });
}

export async function getMetadata(userId: string, { allowRefresh = false }: { allowRefresh?: boolean } = {}): Promise<ProjectedActualMetadata> {
  const projected = await readActualMetadataProjection(userId).catch(() => null);
  if (projected?.syncHealth?.state === "current") return projected;
  if (projected && hasActualMetadataRows(projected)) return projected;
  if (!allowRefresh) throw metadataUnavailableError(projected);
  return refreshActualMetadataProjection(userId).catch((err: unknown) => {
    console.error("[EA] Actual metadata projection refresh failed:", err instanceof Error ? err.message : err);
    if (projected && hasActualMetadataRows(projected)) return projected;
    throw err;
  });
}

export async function refreshActualMetadataProjection(userId: string, {
  dbClient = db,
  now = new Date(),
  metadata = null,
}: { dbClient?: ActualMetadataProjectionDb; now?: Date; metadata?: ActualMetadataInput | null } = {}): Promise<ProjectedActualMetadata> {
  const timestamp = isoNow(now);
  try {
    const actualMetadata = metadataWithPayeeMap(metadata || await loadActualMetadataForProjection(userId));
    await dbClient.execute(upsertMetadataProjectionQuery(userId, actualMetadata, timestamp));
    return {
      ...actualMetadata,
      syncHealth: {
        state: "current",
        lastSuccessAt: timestamp,
        lastAttemptAt: timestamp,
        lastError: null,
      },
    };
  } catch (err: unknown) {
    await dbClient.execute({
      sql: `INSERT INTO ea_actual_metadata_mirror
              (user_id, status, last_attempt_at, last_error, updated_at)
            VALUES (?, 'degraded', ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              status = CASE
                WHEN ea_actual_metadata_mirror.last_success_at IS NULL THEN 'needs_sync'
                ELSE 'degraded'
              END,
              last_attempt_at = excluded.last_attempt_at,
              last_error = excluded.last_error,
              updated_at = excluded.updated_at`,
      args: [userId, timestamp, String(err instanceof Error ? err.message : err).slice(0, 500), timestamp],
    }).catch(() => {});
    throw err;
  }
}
