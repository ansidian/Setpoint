import AdmZip from "adm-zip";
import { createClient } from "@libsql/client";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "path";
import db from "../db/connection.js";
import { decrypt } from "./encryption.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function trimServerUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function actualDataDir(env = process.env) {
  return env.ACTUAL_DATA_DIR || process.cwd();
}

function ymdFromActualDate(value) {
  const raw = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw || null;
}

function actualDateInt(value) {
  return Number(String(value || "").replace(/-/g, ""));
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeRuleConditions(value) {
  return parseJson(value, []).map((condition) => {
    const field = condition?.field === "description"
      ? "payee"
      : condition?.field === "acct"
        ? "account"
        : condition?.field;
    return { ...condition, field };
  });
}

function amountConditionCents(condition) {
  const rawAmt = condition?.value;
  return typeof rawAmt === "object" && rawAmt !== null
    ? (rawAmt.num1 ?? 0)
    : (rawAmt ?? 0);
}

function classifySchedules(schedules, rawPayees) {
  const transferPayeeIds = new Set(rawPayees.filter((payee) => payee.transfer_acct).map((payee) => payee.id));
  return schedules.map((schedule) => {
    const payeeId = schedule.conditions?.find((condition) => condition.field === "payee")?.value;
    const signedAmt = amountConditionCents(schedule.conditions?.find((condition) => condition.field === "amount"));
    let type;
    if (transferPayeeIds.has(payeeId)) type = "transfer";
    else if (signedAmt > 0) type = "income";
    else type = "bill";
    return { ...schedule, type };
  });
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

export async function findLocalBudgetDir(syncId, { dataDir = actualDataDir() } = {}) {
  let entries = [];
  try {
    entries = await readdir(dataDir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const budgetDir = path.join(dataDir, entry.name);
    let metadata;
    try {
      metadata = JSON.parse(await readFile(path.join(budgetDir, "metadata.json"), "utf8"));
    } catch {
      continue;
    }
    if (metadata?.groupId === syncId && metadata?.id && metadata?.cloudFileId) {
      return { budgetDir, metadata };
    }
  }
  return null;
}

export async function pruneActualBudgetBackups(budgetDir, { keep = 1 } = {}) {
  const backupDir = path.join(budgetDir, "backups");
  const keepCount = Math.max(0, Math.floor(Number(keep) || 0));
  let entries = [];
  try {
    entries = await readdir(backupDir, { withFileTypes: true });
  } catch {
    return { removed: 0, kept: 0 };
  }

  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip")) continue;
    const filePath = path.join(backupDir, entry.name);
    try {
      const fileStat = await stat(filePath);
      backups.push({ filePath, mtimeMs: fileStat.mtimeMs });
    } catch {
      // Ignore files that disappeared while pruning.
    }
  }

  backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const stale = backups.slice(keepCount);
  await Promise.all(stale.map((backup) => rm(backup.filePath, { force: true })));
  return { removed: stale.length, kept: backups.length - stale.length };
}

export async function pruneLocalActualBackups({ dataDir = actualDataDir(), keep = 1 } = {}) {
  let entries = [];
  try {
    entries = await readdir(dataDir, { withFileTypes: true });
  } catch {
    return { removed: 0, kept: 0, budgets: 0 };
  }

  let removed = 0;
  let kept = 0;
  let budgets = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const budgetDir = path.join(dataDir, entry.name);
    try {
      await readFile(path.join(budgetDir, "metadata.json"), "utf8");
    } catch {
      continue;
    }
    budgets += 1;
    const result = await pruneActualBudgetBackups(budgetDir, { keep });
    removed += result.removed;
    kept += result.kept;
  }
  return { removed, kept, budgets };
}

async function fileSizeBytes(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return null;
  }
}

async function summarizeBudgetBackups(budgetDir) {
  const backupDir = path.join(budgetDir, "backups");
  let entries = [];
  try {
    entries = await readdir(backupDir, { withFileTypes: true });
  } catch {
    return { backupCount: 0, backupSizeBytes: 0 };
  }

  let backupCount = 0;
  let backupSizeBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip")) continue;
    const size = await fileSizeBytes(path.join(backupDir, entry.name));
    backupCount += 1;
    backupSizeBytes += size || 0;
  }
  return { backupCount, backupSizeBytes };
}

export async function describeLocalActualBudget(budgetDir, { metadata = null } = {}) {
  let resolvedMetadata = metadata;
  if (!resolvedMetadata) {
    try {
      resolvedMetadata = JSON.parse(await readFile(path.join(budgetDir, "metadata.json"), "utf8"));
    } catch {
      resolvedMetadata = {};
    }
  }
  const [dbSizeBytes, backups] = await Promise.all([
    fileSizeBytes(path.join(budgetDir, "db.sqlite")),
    summarizeBudgetBackups(budgetDir),
  ]);
  return {
    budgetId: resolvedMetadata?.id || path.basename(budgetDir),
    syncId: resolvedMetadata?.groupId || null,
    cloudFileId: resolvedMetadata?.cloudFileId || null,
    budgetDir,
    actualDataDir: path.dirname(budgetDir),
    dbSizeBytes,
    ...backups,
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

function timeoutMs() {
  const value = Number(process.env.EA_ACTUAL_LIGHTWEIGHT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function fetchActualJson(url, { token = null, fileId = null, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let response;
  let text = "";
  try {
    response = await fetch(url, {
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
  } catch (err) {
    throw Object.assign(new Error(err?.name === "AbortError"
      ? "Actual Budget lightweight metadata request timed out"
      : "Actual Budget server is unreachable"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw Object.assign(new Error(`Actual Budget returned non-JSON response: ${text.slice(0, 120)}`), { status: 502 });
  }
}

async function fetchActualBuffer(url, { token, fileId }) {
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

async function downloadBudgetZip(config, { dataDir = actualDataDir() } = {}) {
  if (!config.password) {
    throw Object.assign(new Error("Actual Budget password is required for lightweight metadata download"), { status: 400 });
  }
  const login = await fetchActualJson(`${config.serverURL}/account/login`, {
    body: { password: config.password, loginMethod: "password" },
  });
  const token = login?.data?.token;
  if (!token) throw Object.assign(new Error("Actual Budget login did not return a session token"), { status: 502 });

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
  let backupPrune = { removed: 0, kept: 0 };
  backupPrune = await pruneActualBudgetBackups(budgetDir).catch((err) => {
    console.warn("[EA] Actual local backup pruning failed:", err.message);
    return backupPrune;
  });
  return { budgetDir, metadata, backupPrune };
}

async function ensureLocalBudget(config, options = {}) {
  const downloadBudget = options.downloadBudget || downloadBudgetZip;
  if (options.refresh) return downloadBudget(config, options);
  const local = await findLocalBudgetDir(config.syncId, options);
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
        sql: `SELECT id, date, amount, payee, schedule
              FROM v_transactions
              WHERE COALESCE(tombstone, 0) = 0
                AND payee IS NOT NULL
                AND amount != 0
                AND date >= ?
              ORDER BY date DESC`,
        args: [actualDateInt(new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }))],
      }),
    ]);

    const accounts = rawAccounts.rows.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
    }));
    const payees = rawPayees.rows
      .filter((payee) => payee.name && !payee.transfer_acct)
      .map((payee) => ({ id: payee.id, name: payee.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const payeeMap = Object.fromEntries(rawPayees.rows.map((payee) => [payee.id, payee.name || ""]));
    const categoriesByGroup = new Map();
    for (const category of rawCategories.rows) {
      if (!categoriesByGroup.has(category.cat_group)) categoriesByGroup.set(category.cat_group, []);
      categoriesByGroup.get(category.cat_group).push({ id: category.id, name: category.name });
    }
    const categories = rawGroups.rows
      .filter((group) => group.name !== "Internal")
      .map((group) => ({
        group_name: group.name,
        categories: categoriesByGroup.get(group.id) || [],
      }));
    const schedules = classifySchedules(rawSchedules.rows.map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      rule: schedule.rule,
      next_date: ymdFromActualDate(schedule.next_date),
      completed: !!schedule.completed,
      conditions: normalizeRuleConditions(schedule._conditions),
    })), rawPayees.rows);
    const recentTransactions = rawTransactions.rows.map((transaction) => ({
      payee: payeeMap[transaction.payee] || "",
      payeeId: transaction.payee,
      amount: Math.abs(Number(transaction.amount || 0)) / 100,
      date: ymdFromActualDate(transaction.date),
      scheduleId: transaction.schedule || null,
    }));

    return { accounts, payees, payeeMap, categories, schedules, recentTransactions };
  } finally {
    await client.close();
  }
}

export const __testing__ = {
  ymdFromActualDate,
  normalizeRuleConditions,
  findLocalBudgetDir,
};
