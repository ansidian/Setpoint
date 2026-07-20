import AdmZip from "adm-zip";
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
import {
  loginActual,
  fetchActualJson,
  fetchActualBuffer,
  syncDownloadedBudget,
} from "./actualMetadataSync.ts";
import { assertSafeActualBudgetArchive, validateActualBudgetId } from "./actual-budget-archive.ts";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import db from "../db/connection.ts";
import { decrypt } from "../platform/encryption.ts";
import { settingsCredentialContext } from "../platform/credential-encryption-context.ts";
import type { ActualConfig, ActualMetadata } from "../../shared/types/actual.ts";

interface LocalBudget {
  budgetDir: string;
  metadata: BudgetMetadata & { id?: string; groupId: string; cloudFileId: string };
  backupPrune?: { removed: number; kept: number };
  syncDeltas?: Record<string, unknown>;
}

export interface LocalActualOptions {
  dbClient?: { execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }> };
  dataDir?: string;
  refresh?: boolean;
  forceDownload?: boolean;
  localOnly?: boolean;
  downloadBudget?: (config: ActualConfig, options?: LocalActualOptions) => Promise<LocalBudget>;
  syncBudget?: (config: ActualConfig, options?: LocalActualOptions & { local?: LocalBudget }) => Promise<LocalBudget>;
  local?: LocalBudget;
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
// importable from here for the existing consumers (actual-transactions-read.ts,
// actual-core.ts, actual-lightweight-writes.ts, prune-actual-cache.js).
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
    sql: "SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id FROM ea_settings WHERE user_id = ?",
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

async function downloadBudgetZip(config: ActualConfig, { dataDir = actualDataDir() }: LocalActualOptions = {}): Promise<LocalBudget> {
  const token = await loginActual(config);

  const files = await fetchActualJson<{ data?: Array<{ groupId?: string; fileId?: string }> }>(`${config.serverURL}/sync/list-user-files`, { token });
  const file = (Array.isArray(files?.data) ? files.data : []).find((candidate) => candidate?.groupId === config.syncId);
  if (!file?.fileId) {
    throw Object.assign(new Error(`Actual Budget "${config.syncId}" was not found on the sync server`), { status: 404 });
  }
  const fileId = file.fileId;

  const fileInfo = await fetchActualJson<{ status?: string; data?: { encryptMeta?: boolean } }>(`${config.serverURL}/sync/get-user-file-info`, { token, fileId });
  const info = fileInfo?.data;
  if (fileInfo?.status !== "ok" || !info) {
    throw Object.assign(new Error("Actual Budget file info was unavailable"), { status: 502 });
  }
  if (info.encryptMeta) {
    throw Object.assign(new Error("Encrypted Actual Budget files are not supported by lightweight metadata download"), { status: 400 });
  }

  const buffer = await fetchActualBuffer(`${config.serverURL}/sync/download-user-file`, {
    token,
    fileId,
  });
  assertSafeActualBudgetArchive(buffer);
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const dbEntries = entries.filter((entry) => entry.entryName.split(/[\\/]/).at(-1) === "db.sqlite");
  const metaEntries = entries.filter((entry) => entry.entryName.split(/[\\/]/).at(-1) === "metadata.json");
  const dbEntry = dbEntries.length === 1 ? dbEntries[0] : null;
  const metaEntry = metaEntries.length === 1 ? metaEntries[0] : null;
  if (!dbEntry || !metaEntry) {
    throw Object.assign(new Error("Actual Budget download did not include db.sqlite and metadata.json"), { status: 502 });
  }

  const parsedMetadata = JSON.parse(zip.readAsText(metaEntry)) as BudgetMetadata;
  const budgetId = validateActualBudgetId(parsedMetadata.id);
  const metadata: LocalBudget["metadata"] = {
    ...parsedMetadata,
    id: budgetId,
    cloudFileId: fileId,
    groupId: file.groupId || config.syncId,
    lastUploaded: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    encryptKeyId: null,
  };
  const budgetDir = path.join(dataDir, budgetId);
  await mkdir(budgetDir, { recursive: true });
  const databaseBuffer = zip.readFile(dbEntry);
  if (!databaseBuffer) throw Object.assign(new Error("Actual Budget download did not include a readable db.sqlite"), { status: 502 });
  await writeFile(path.join(budgetDir, "db.sqlite"), databaseBuffer);
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify(metadata));
  const syncDeltas = await syncDownloadedBudget(config, token, { budgetDir, metadata });
  let backupPrune = { removed: 0, kept: 0 };
  backupPrune = await pruneActualBudgetBackups(budgetDir).catch((err: unknown) => {
    console.warn("[EA] Actual local backup pruning failed:", err instanceof Error ? err.message : err);
    return backupPrune;
  });
  return { budgetDir, metadata: syncDeltas.metadata, backupPrune, syncDeltas };
}

async function syncLocalBudget(config: ActualConfig, { local }: LocalActualOptions = {}): Promise<LocalBudget> {
  if (!local?.budgetDir || !local?.metadata) {
    throw Object.assign(new Error("Actual Budget local metadata is unavailable"), { status: 503 });
  }
  const token = await loginActual(config);
  const syncDeltas = await syncDownloadedBudget(config, token, {
    budgetDir: local.budgetDir,
    metadata: local.metadata,
  });
  let backupPrune = { removed: 0, kept: 0 };
  backupPrune = await pruneActualBudgetBackups(local.budgetDir).catch((err: unknown) => {
    console.warn("[EA] Actual local backup pruning failed:", err instanceof Error ? err.message : err);
    return backupPrune;
  });
  return {
    budgetDir: local.budgetDir,
    metadata: syncDeltas.metadata,
    backupPrune,
    syncDeltas,
  };
}

async function ensureLocalBudget(config: ActualConfig, options: LocalActualOptions = {}): Promise<LocalBudget> {
  const downloadBudget = options.downloadBudget || downloadBudgetZip;
  const syncBudget = options.syncBudget || syncLocalBudget;
  const found = await findLocalBudgetDir(config.syncId, options);
  const local = found ? { ...found, metadata: found.metadata as LocalBudget["metadata"] } : null;
  if (options.refresh) {
    if (local && !options.forceDownload) return syncBudget(config, { ...options, local });
    return downloadBudget(config, options);
  }
  if (local) return local;
  if (options.localOnly) {
    throw Object.assign(new Error("Actual Budget local metadata is unavailable"), { status: 503 });
  }
  return downloadBudget(config, options);
}

export async function hydrateLocalActualCache(userId: string, options: LocalActualOptions = {}) {
  const config = await getActualConfig(userId, options);
  const hydrated = await ensureLocalBudget(config, {
    ...options,
    refresh: true,
  });
  const summary = await describeLocalActualBudget(hydrated.budgetDir, {
    metadata: hydrated.metadata,
  });
  return {
    success: true,
    hydrated: true,
    ...summary,
    backupPrune: hydrated.backupPrune || { removed: 0, kept: summary.backupCount },
  };
}

// Direct read access to the on-disk budget copy without booting the SDK — the
// same path readLocalActualMetadata uses, exposed so other readers (e.g.
// transactions) can run their own queries against db.sqlite. localOnly defaults
// to true: a missing copy throws 503 rather than triggering a download.
export async function openLocalBudgetClient(userId: string, options: LocalActualOptions = {}): Promise<Client> {
  const config = await getActualConfig(userId, options);
  const local = await ensureLocalBudget(config, {
    ...options,
    localOnly: options.localOnly !== false,
  });
  return createClient({ url: `file:${path.join(local.budgetDir, "db.sqlite")}` });
}

export async function readLocalActualMetadata(userId: string, options: LocalActualOptions = {}): Promise<ActualMetadata> {
  const config = await getActualConfig(userId, options);
  const local = await ensureLocalBudget(config, options);
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
      client.execute(`SELECT id, name, rule, next_date, completed, _conditions
                      FROM v_schedules
                      WHERE COALESCE(tombstone, 0) = 0
                      ORDER BY next_date, name COLLATE NOCASE`),
      client.execute({
        // LIMIT bounds the view-backed 30-day scan (P3-7). The only consumer,
        // isSchedulePaid, matches transactions within ~3-14 days of a schedule's
        // next_date, so the most recent 1000 rows comfortably cover it.
        sql: `SELECT id, date, amount, payee, schedule
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
