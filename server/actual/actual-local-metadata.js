import AdmZip from "adm-zip";
import { createClient } from "@libsql/client";
import {
  projectActualMetadata,
  actualDateInt,
  ymdFromActualDate,
  normalizeRuleConditions,
} from "./actualMetadataModel.js";
import {
  actualDataDir,
  findLocalBudgetDir,
  describeLocalActualBudget,
  pruneActualBudgetBackups,
  pruneLocalActualBackups,
} from "./actualMetadataCacheStore.js";
import {
  loginActual,
  fetchActualJson,
  fetchActualBuffer,
  syncDownloadedBudget,
} from "./actualMetadataSync.js";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import db from "../db/connection.ts";
import { decrypt } from "../platform/encryption.js";

// Facade re-exports: pure date helpers (actualMetadataModel.js) and filesystem
// cache ops (actualMetadataCacheStore.js) now live in their own modules but stay
// importable from here for the existing consumers (actual-transactions-read.js,
// actual-core.js, actual-lightweight-writes.js, prune-actual-cache.js).
export { ymdFromActualDate, actualDateInt };
export {
  actualDataDir,
  findLocalBudgetDir,
  pruneActualBudgetBackups,
  pruneLocalActualBackups,
  describeLocalActualBudget,
};

function trimServerUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export async function getActualConfig(userId, { dbClient = db } = {}) {
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
      ? decrypt(settings.actual_budget_password_encrypted)
      : null,
    syncId: settings.actual_budget_sync_id,
  };
}

export async function describeLocalActualCache(userId, options = {}) {
  let config;
  try {
    config = await getActualConfig(userId, options);
  } catch (err) {
    if (err?.status === 400) {
      return {
        success: true,
        configured: false,
        hydrated: false,
        actualDataDir: options.dataDir || actualDataDir(),
        message: err.message,
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

async function downloadBudgetZip(config, { dataDir = actualDataDir() } = {}) {
  const token = await loginActual(config);

  const files = await fetchActualJson(`${config.serverURL}/sync/list-user-files`, { token });
  const file = (Array.isArray(files?.data) ? files.data : []).find((candidate) => candidate?.groupId === config.syncId);
  if (!file?.fileId) {
    throw Object.assign(new Error(`Actual Budget "${config.syncId}" was not found on the sync server`), { status: 404 });
  }

  const fileInfo = await fetchActualJson(`${config.serverURL}/sync/get-user-file-info`, { token, fileId: file.fileId });
  const info = fileInfo?.data;
  if (fileInfo?.status !== "ok" || !info) {
    throw Object.assign(new Error("Actual Budget file info was unavailable"), { status: 502 });
  }
  if (info.encryptMeta) {
    throw Object.assign(new Error("Encrypted Actual Budget files are not supported by lightweight metadata download"), { status: 400 });
  }

  const buffer = await fetchActualBuffer(`${config.serverURL}/sync/download-user-file`, {
    token,
    fileId: file.fileId,
  });
  const zip = new AdmZip(buffer);
  const dbEntry = zip.getEntries().find((entry) => entry.entryName.includes("db.sqlite"));
  const metaEntry = zip.getEntries().find((entry) => entry.entryName.includes("metadata.json"));
  if (!dbEntry || !metaEntry) {
    throw Object.assign(new Error("Actual Budget download did not include db.sqlite and metadata.json"), { status: 502 });
  }

  const metadata = {
    ...JSON.parse(zip.readAsText(metaEntry)),
    cloudFileId: file.fileId,
    groupId: file.groupId,
    lastUploaded: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    encryptKeyId: null,
  };
  const budgetDir = path.join(dataDir, metadata.id);
  await mkdir(budgetDir, { recursive: true });
  await writeFile(path.join(budgetDir, "db.sqlite"), zip.readFile(dbEntry));
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify(metadata));
  const syncDeltas = await syncDownloadedBudget(config, token, { budgetDir, metadata });
  let backupPrune = { removed: 0, kept: 0 };
  backupPrune = await pruneActualBudgetBackups(budgetDir).catch((err) => {
    console.warn("[EA] Actual local backup pruning failed:", err.message);
    return backupPrune;
  });
  return { budgetDir, metadata: syncDeltas.metadata, backupPrune, syncDeltas };
}

async function syncLocalBudget(config, { local } = {}) {
  if (!local?.budgetDir || !local?.metadata) {
    throw Object.assign(new Error("Actual Budget local metadata is unavailable"), { status: 503 });
  }
  const token = await loginActual(config);
  const syncDeltas = await syncDownloadedBudget(config, token, {
    budgetDir: local.budgetDir,
    metadata: local.metadata,
  });
  let backupPrune = { removed: 0, kept: 0 };
  backupPrune = await pruneActualBudgetBackups(local.budgetDir).catch((err) => {
    console.warn("[EA] Actual local backup pruning failed:", err.message);
    return backupPrune;
  });
  return {
    budgetDir: local.budgetDir,
    metadata: syncDeltas.metadata,
    backupPrune,
    syncDeltas,
  };
}

async function ensureLocalBudget(config, options = {}) {
  const downloadBudget = options.downloadBudget || downloadBudgetZip;
  const syncBudget = options.syncBudget || syncLocalBudget;
  const local = await findLocalBudgetDir(config.syncId, options);
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

export async function hydrateLocalActualCache(userId, options = {}) {
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
export async function openLocalBudgetClient(userId, options = {}) {
  const config = await getActualConfig(userId, options);
  const local = await ensureLocalBudget(config, {
    ...options,
    localOnly: options.localOnly !== false,
  });
  return createClient({ url: `file:${path.join(local.budgetDir, "db.sqlite")}` });
}

export async function readLocalActualMetadata(userId, options = {}) {
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

export const __testing__ = {
  normalizeRuleConditions,
  findLocalBudgetDir,
  syncDownloadedBudget,
};
