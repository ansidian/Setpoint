import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import type { InStatement } from "@libsql/client";
import {
  projectActualMetadata,
  actualDateInt,
  ymdFromActualDate,
} from "./actualMetadataModel.ts";
import {
  actualDataDir,
  findLocalBudgetDir,
  describeLocalActualBudget,
  pruneActualBudgetBackups,
  pruneLocalActualBackups,
} from "./actualMetadataCacheStore.ts";
import type { BudgetMetadata } from "./actualMetadataCacheStore.ts";
import path from "path";
import db from "../db/connection.ts";
import { decrypt } from "../platform/encryption.ts";
import { settingsCredentialContext } from "../platform/credential-encryption-context.ts";
import type { ActualConfig, ActualMetadata } from "../../shared/types/actual.ts";

interface LocalBudget {
  budgetDir: string;
  metadata: BudgetMetadata & { id?: string; groupId: string; cloudFileId: string };
}

export interface LocalActualOptions {
  dbClient?: { execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }> };
  dataDir?: string;
  localOnly?: boolean;
}

export interface CacheDescription {
  success: true;
  configured: boolean;
  hydrated: boolean;
  actualDataDir: string;
  message?: string;
  [key: string]: unknown;
}

// Facade re-exports: pure date helpers (actualMetadataModel.ts) and filesystem
// cache ops (actualMetadataCacheStore.ts) now live in their own modules but stay
// importable from here for the existing consumers
// (actual-core.ts, actual-journal-read.ts, prune-actual-cache.ts).
export { ymdFromActualDate, actualDateInt };
export {
  actualDataDir,
  findLocalBudgetDir,
  pruneActualBudgetBackups,
  pruneLocalActualBackups,
  describeLocalActualBudget,
};

function trimServerUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

export async function getActualConfig(userId: string, { dbClient = db }: LocalActualOptions = {}): Promise<ActualConfig> {
  const result = await dbClient.execute({
    sql: `SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id,
                 actual_budget_encryption_password_encrypted
          FROM ea_settings WHERE user_id = ?`,
    args: [userId],
  });
  const settings = result.rows?.[0];
  if (!settings?.actual_budget_url || !settings?.actual_budget_sync_id) {
    throw Object.assign(new Error("Actual Budget not configured in EA settings"), { status: 400 });
  }
  return {
    serverURL: trimServerUrl(settings.actual_budget_url),
    password: settings.actual_budget_password_encrypted
      ? decrypt(
          String(settings.actual_budget_password_encrypted),
          settingsCredentialContext(userId, "actual_budget_password_encrypted"),
        )
      : null,
    syncId: String(settings.actual_budget_sync_id),
    encryptionPassword: settings.actual_budget_encryption_password_encrypted
      ? decrypt(
          String(settings.actual_budget_encryption_password_encrypted),
          settingsCredentialContext(userId, "actual_budget_encryption_password_encrypted"),
        )
      : null,
  };
}

export async function describeLocalActualCache(userId: string, options: LocalActualOptions = {}): Promise<CacheDescription> {
  let config: ActualConfig;
  try {
    config = await getActualConfig(userId, options);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "status" in err && err.status === 400) {
      return {
        success: true,
        configured: false,
        hydrated: false,
        actualDataDir: options.dataDir || actualDataDir(),
        message: err instanceof Error ? err.message : "Actual Budget is not configured",
      };
    }
    throw err;
  }

  const dataDir = options.dataDir || actualDataDir();
  const local = await findLocalBudgetDir(config.syncId, { dataDir });
  if (!local?.budgetDir) {
    return {
      success: true,
      configured: true,
      hydrated: false,
      syncId: config.syncId,
      actualDataDir: dataDir,
      message: "Actual local budget cache not found",
    };
  }

  const summary = await describeLocalActualBudget(local.budgetDir, {
    metadata: local.metadata,
  });
  return {
    success: true,
    configured: true,
    hydrated: true,
    ...summary,
  };
}

async function requireLocalBudget(config: ActualConfig, options: LocalActualOptions): Promise<LocalBudget> {
  const found = await findLocalBudgetDir(config.syncId, options);
  if (!found) {
    throw Object.assign(new Error("Actual Budget local metadata is unavailable"), { status: 503 });
  }
  return { ...found, metadata: found.metadata as LocalBudget["metadata"] };
}

// Direct read access to the on-disk budget copy without booting the SDK — the
// same path readLocalActualMetadata uses, exposed so other readers (e.g.
// transactions) can run their own queries against db.sqlite. A missing copy
// always throws 503; reads never download, synchronize, or replace the cache.
export async function openLocalBudgetClient(userId: string, options: LocalActualOptions = {}): Promise<Client> {
  const config = await getActualConfig(userId, options);
  const local = await requireLocalBudget(config, options);
  return createClient({ url: `file:${path.join(local.budgetDir, "db.sqlite")}` });
}

export async function readLocalActualMetadata(userId: string, options: LocalActualOptions = {}): Promise<ActualMetadata> {
  const config = await getActualConfig(userId, options);
  const local = await requireLocalBudget(config, options);
  const budgetDb = path.join(local.budgetDir, "db.sqlite");
  const client = createClient({ url: `file:${budgetDb}` });
  try {
    const [
      rawAccounts,
      rawPayees,
      rawGroups,
      rawCategories,
      rawSchedules,
      rawTransactions,
    ] = await Promise.all([
      client.execute("SELECT id, name, type FROM accounts WHERE COALESCE(closed, 0) = 0 AND COALESCE(tombstone, 0) = 0 ORDER BY name COLLATE NOCASE"),
      client.execute("SELECT id, name, transfer_acct FROM payees WHERE COALESCE(tombstone, 0) = 0"),
      client.execute("SELECT id, name, sort_order FROM category_groups WHERE COALESCE(tombstone, 0) = 0 ORDER BY sort_order, name COLLATE NOCASE"),
      client.execute("SELECT id, name, cat_group, sort_order FROM categories WHERE COALESCE(tombstone, 0) = 0 ORDER BY sort_order, name COLLATE NOCASE"),
      client.execute(`SELECT id, name, rule, next_date, completed, posts_transaction, _conditions
                      FROM v_schedules
                      WHERE COALESCE(tombstone, 0) = 0
                      ORDER BY next_date, name COLLATE NOCASE`),
      client.execute({
        // Bound the existing 30-day metadata scan. Exact schedule postings retain
        // their IDs for paid-state projection; Journal owns wider dated reads.
        sql: `SELECT id, date, amount, payee, account, schedule
              FROM v_transactions
              WHERE COALESCE(tombstone, 0) = 0
                AND payee IS NOT NULL
                AND amount != 0
                AND date >= ?
              ORDER BY date DESC
              LIMIT 1000`,
        args: [actualDateInt(new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }))],
      }),
    ]);

    return projectActualMetadata({
      rawAccounts,
      rawPayees,
      rawGroups,
      rawCategories,
      rawSchedules,
      rawTransactions,
    });
  } finally {
    await client.close();
  }
}
