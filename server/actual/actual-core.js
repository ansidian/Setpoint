import actualApi from "@actual-app/api";
import { decrypt } from "../platform/encryption.js";
import { filterBillSchedulesForRange } from "./actual-bill-occurrences.js";
import {
  actualDataDir,
  findLocalBudgetDir,
  pruneActualBudgetBackups,
} from "./actual-local-metadata.js";
import {
  actualSessionKey,
  classifySchedules,
  findScheduleByPayee,
  findScheduleByName,
  buildDateCondition,
  mapOpenBillInstances,
  transactionSearchStart,
  projectSdkMetadata,
  mapRecentTransactions,
  mapUpcomingBills,
} from "./actualCoreModel.js";
import db from "../db/connection.js";

export { isSchedulePaid } from "./actual-bill-occurrences.js";

async function getActualConfig(userId) {
  const result = await db.execute({
    sql: "SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  const settings = result.rows[0];
  if (!settings?.actual_budget_url || !settings?.actual_budget_sync_id) {
    throw new Error("Actual Budget not configured in EA settings");
  }
  return {
    serverURL: settings.actual_budget_url.replace(/\/+$/, ""),
    password: settings.actual_budget_password_encrypted
      ? decrypt(settings.actual_budget_password_encrypted)
      : null,
    syncId: settings.actual_budget_sync_id,
  };
}

// --- Mutex: serialize all Actual Budget API access (singleton contention prevention) ---
let lock = Promise.resolve();
let activeBudget = null;

// PERF-L08: pruning is a readdir+stat sweep and backups only appear on SDK
// snapshots, so once per interval per budget directory is sufficient.
const BACKUP_PRUNE_INTERVAL_MS = 15 * 60 * 1000;
const lastBackupPruneAt = new Map();

async function maybePruneBackups(budgetDir) {
  const now = Date.now();
  if ((lastBackupPruneAt.get(budgetDir) ?? 0) + BACKUP_PRUNE_INTERVAL_MS > now) return;
  lastBackupPruneAt.set(budgetDir, now);
  await pruneActualBudgetBackups(budgetDir).catch((err) => {
    console.warn("[EA] Actual local backup pruning failed:", err.message);
  });
}

function resetBackupPruneThrottle() {
  lastBackupPruneAt.clear();
}

function allowColdActualDownload() {
  return process.env.NODE_ENV !== "production" || process.env.EA_ACTUAL_ALLOW_COLD_SDK_DOWNLOAD === "1";
}

function withLock(fn) {
  const result = lock.then(() => fn());
  lock = result.catch(() => {});
  return result;
}

async function closeActualSession() {
  activeBudget = null;
  await actualApi.shutdown().catch(() => {});
}

async function ensureActualBudget(userId) {
  const baseConfig = await getActualConfig(userId);
  const dataDir = actualDataDir();
  const localBudget = await findLocalBudgetDir(baseConfig.syncId, { dataDir }).catch((err) => {
    console.warn("[EA] Actual local budget lookup failed; falling back to cold download path:", err.message);
    return null;
  });
  const config = {
    ...baseConfig,
    dataDir,
    localBudgetId: localBudget?.metadata?.id || null,
    localBudgetDir: localBudget?.budgetDir || null,
  };
  const key = actualSessionKey(config);
  if (activeBudget?.key === key) return config;
  if (activeBudget) {
    await closeActualSession();
  }
  try {
    await actualApi.init({ serverURL: config.serverURL, password: config.password, dataDir });
    if (config.localBudgetId) {
      const result = await actualApi.loadBudget(config.localBudgetId);
      if (result?.error) {
        throw Object.assign(new Error(`Actual local budget load failed: ${result.error}`), {
          status: 503,
          code: "ACTUAL_LOCAL_BUDGET_LOAD_FAILED",
        });
      }
    } else {
      if (!allowColdActualDownload()) {
        throw Object.assign(new Error("Actual local budget cache is unavailable; refusing cold Actual download in production"), {
          status: 503,
          code: "ACTUAL_LOCAL_BUDGET_REQUIRED",
        });
      }
      await actualApi.downloadBudget(
        config.syncId,
        config.password ? { password: config.password } : undefined,
      );
    }
    activeBudget = { key, ...config, loadedAt: new Date().toISOString() };
    return config;
  } catch (error) {
    await closeActualSession();
    throw error;
  }
}

async function withActualBudget(userId, fn) {
  const config = await ensureActualBudget(userId);
  try {
    const result = await fn(config);
    if (config.localBudgetDir) {
      await maybePruneBackups(config.localBudgetDir);
    }
    return result;
  } catch (error) {
    await closeActualSession();
    throw error;
  }
}

// --- Metadata cache: 5-minute TTL ---
const METADATA_TTL_MS = 5 * 60 * 1000;
let metadataCache = { data: null, ts: 0 };

export function clearMetadataCache() {
  metadataCache = { data: null, ts: 0 };
}

export function testConnection(userId, overrides = null) {
  return withLock(async () => {
    let serverURL, password, syncId;
    if (overrides && overrides.serverURL && overrides.syncId) {
      serverURL = overrides.serverURL.replace(/\/+$/, "");
      syncId = overrides.syncId;
      if (overrides.password) {
        password = overrides.password;
      } else {
        // Dirty URL/sync-id but password unchanged — fall back to stored password
        const stored = await getActualConfig(userId).catch(() => null);
        password = stored?.password || null;
      }
    } else {
      ({ serverURL, password, syncId } = await getActualConfig(userId));
    }

    try {
      await actualApi.init({ serverURL, password });
      // getBudgets validates auth + connectivity without downloading/syncing
      const budgets = await actualApi.getBudgets();
      const found = budgets.some((b) => b.groupId === syncId);
      return {
        success: true,
        budgetCount: budgets.length,
        budgetFound: found,
      };
    } finally {
      await closeActualSession();
    }
  });
}

// Fetch all Actual Budget metadata in a single connection (accounts, payees, categories)
// The @actual-app/api is a singleton — parallel init/shutdown calls conflict,
// so we batch everything into one connection.
// Cache check is inside withLock to prevent cache stampede (D-03 from RESEARCH.md).
export function getMetadata(userId, { forceRefresh = false } = {}) {
  return withLock(() => getMetadataInner(userId, { forceRefresh }));
}

// Inner body — assumes caller already holds the withLock mutex. Lets operations
// like createQuickTxn chain metadata fetch + mutation inside one critical section
// without re-entering the lock (which would serialize against itself).
async function getMetadataInner(userId, { forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && metadataCache.data && now - metadataCache.ts < METADATA_TTL_MS) {
      return metadataCache.data;
    }

    if (forceRefresh) {
      clearMetadataCache();
      await closeActualSession();
    }

    return withActualBudget(userId, async () => {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      const [rawAccounts, rawPayees, groups, schedules, recentTxns] = await Promise.all([
        actualApi.getAccounts(),
        actualApi.getPayees(),
        actualApi.getCategoryGroups(),
        getSchedulesWithConditions().catch(() => []),
        actualApi.runQuery(
          actualApi.q("transactions")
            .filter({ date: { $gte: monthAgo } })
            .select(["id", "date", "amount", "payee", "schedule"])
        ).then(r => r.data).catch(() => []),
      ]);

      const result = projectSdkMetadata({ rawAccounts, rawPayees, groups, schedules, recentTxns });
      metadataCache = { data: result, ts: Date.now() };
      return result;
    });
}

// Individual accessors for routes/services that only need one metadata slice.
export async function getAccounts(userId) {
  const { accounts } = await getMetadata(userId);
  return accounts;
}

export async function getRecentTransactions(userId) {
  const { recentTransactions } = await getMetadata(userId);
  return recentTransactions;
}

export async function getPayees(userId) {
  const { payees } = await getMetadata(userId);
  return payees;
}

export async function getCategories(userId) {
  const { categories } = await getMetadata(userId);
  return categories;
}

// --- Schedule helpers (ported from actual-helper.mjs) ---

async function getSchedulesWithConditions({ includeCompleted = false } = {}) {
  const rows = (await actualApi.runQuery(
    actualApi.q('schedules').select(['id', 'name', 'rule', 'next_date', 'completed'])
  )).data;
  const rules = await actualApi.getRules();
  const ruleMap = Object.fromEntries(rules.map(r => [r.id, r]));
  return rows
    .filter(s => includeCompleted || !s.completed)
    .map(s => ({ ...s, conditions: ruleMap[s.rule]?.conditions || [] }));
}

async function resolvePayee(payeeName) {
  if (!payeeName) return null;
  const payees = await actualApi.getPayees();
  const match = payees.find(p => p.name?.toLowerCase() === payeeName.toLowerCase());
  return match ? match.id : await actualApi.createPayee({ name: payeeName });
}

// --- Shared schedule helpers ---

async function findExistingSchedule(payeeId, accountId, amount, name) {
  if (payeeId) {
    const schedules = await getSchedulesWithConditions();
    const existing = findScheduleByPayee(schedules, payeeId, accountId, Math.abs(amount));
    if (existing) return existing.id;
  }
  if (name) {
    const allSchedules = await getSchedulesWithConditions({ includeCompleted: true });
    // Name fallback with the cross-type sign guard (bill <-> transfer). The amount read
    // routes through actual-amount-condition.js so an `isbetween` range is interpreted,
    // not skipped, and a transfer can't clobber a same-named range bill (P3-76).
    const byName = findScheduleByName(allSchedules, name, amount);
    if (byName) return byName.id;
  }
  return null;
}

async function updateExistingSchedule(existingId, newDueDate, amount, extraConditions = []) {
  const allSchedules = await getSchedulesWithConditions({ includeCompleted: true });
  const existing = allSchedules.find(s => s.id === existingId);
  const oldConditions = existing?.conditions || [];

  const newConditions = [
    buildDateCondition(oldConditions, newDueDate),
    { op: "is", field: "amount", value: amount },
    ...extraConditions,
  ];

  // Preserve non-date, non-amount conditions that aren't in extraConditions
  const extraFields = new Set(extraConditions.map(c => c.field));
  for (const c of oldConditions) {
    if (c.field !== "date" && c.field !== "amount" && !extraFields.has(c.field)) {
      newConditions.push(c);
    }
  }

  await actualApi.internal.send("schedule/update", {
    schedule: { id: existingId, completed: false },
    conditions: newConditions,
  });
  return existing?.name;
}

async function createOrReuseSchedule(name, dueDate, amount, conditions) {
  const allSchedules = await getSchedulesWithConditions({ includeCompleted: true });
  // Preserve the P3-76 cross-type sign guard on this last-resort name fallback;
  // amount conditions, including `isbetween`, are interpreted by the shared model.
  const byName = findScheduleByName(allSchedules, name, amount);
  if (byName) {
    await actualApi.internal.send("schedule/update", {
      schedule: { id: byName.id, completed: false },
      conditions,
    });
    return { reused: true, name };
  }
  const id = await actualApi.createSchedule({ name, date: dueDate, amount });
  await actualApi.internal.send("schedule/update", { schedule: { id, name }, conditions });
  return { reused: false, name };
}

async function upsertSchedule(billData, targetAccountId) {
  const amountCents = -Math.round(billData.amount * 100);
  const isIncome = billData.type === "income";
  const signedAmount = isIncome ? Math.abs(amountCents) : amountCents;
  const name = billData.payee;

  // Past-date: create posted transaction instead
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  if (billData.due_date <= today) {
    const txn = { date: billData.due_date, amount: signedAmount, cleared: false };
    const payeeId = await resolvePayee(billData.payee);
    if (payeeId) txn.payee = payeeId;
    if (billData.category_id) txn.category = billData.category_id;
    await actualApi.addTransactions(targetAccountId, [txn]);
    return { success: true, message: `Transaction "${name}" created (date is today or past)` };
  }

  const payeeId = await resolvePayee(billData.payee);
  const existingId = await findExistingSchedule(payeeId, targetAccountId, amountCents, name);

  if (existingId) {
    const existingName = await updateExistingSchedule(existingId, billData.due_date, signedAmount);
    return { success: true, message: `Updated schedule "${existingName || name}"` };
  }

  const conditions = [
    { op: "is", field: "date", value: billData.due_date },
    { op: "is", field: "amount", value: signedAmount },
  ];
  if (payeeId) conditions.push({ op: "is", field: "payee", value: payeeId });
  if (targetAccountId) conditions.push({ op: "is", field: "account", value: targetAccountId });

  const result = await createOrReuseSchedule(name, billData.due_date, signedAmount, conditions);
  return { success: true, message: result.reused ? `Updated existing schedule "${name}"` : `Schedule "${name}" created` };
}

async function upsertTransferSchedule(billData) {
  const amountCents = Math.round(billData.amount * 100); // positive for transfers into account

  // Find the transfer payee (special payee linked to from_account)
  const payees = await actualApi.getPayees();
  const transferPayee = payees.find(p => p.transfer_acct === billData.from_account_id);
  if (!transferPayee) {
    const err = new Error("No transfer payee found for selected source account");
    err.status = 400;
    throw err;
  }

  // Past-date: create posted transfer transaction
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  if (billData.due_date <= today) {
    await actualApi.addTransactions(billData.to_account_id, [{
      date: billData.due_date,
      amount: amountCents,
      payee: transferPayee.id,
      cleared: false,
    }]);
    return { success: true, message: `Transfer created as transaction (date is today or past)` };
  }

  const name = billData.schedule_name;
  const extraConditions = [
    { op: "is", field: "payee", value: transferPayee.id },
    { op: "is", field: "account", value: billData.to_account_id },
  ];

  const existingId = await findExistingSchedule(transferPayee.id, billData.to_account_id, amountCents, name);

  if (existingId) {
    const existingName = await updateExistingSchedule(existingId, billData.due_date, amountCents, extraConditions);
    return { success: true, message: `Updated transfer schedule "${existingName || name}"` };
  }

  const conditions = [
    { op: "is", field: "date", value: billData.due_date },
    { op: "is", field: "amount", value: amountCents },
    ...extraConditions,
  ];

  const result = await createOrReuseSchedule(name, billData.due_date, amountCents, conditions);
  return { success: true, message: result.reused ? `Updated existing transfer schedule "${name}"` : `Transfer schedule "${name}" created` };
}

async function getRecentTransactionsForSchedules(schedules, payeeMap) {
  const start = transactionSearchStart(schedules);
  if (!start) return [];
  return actualApi.runQuery(
    actualApi.q("transactions")
      .filter({ date: { $gte: start } })
      .select(["id", "date", "amount", "payee", "schedule"])
  ).then((result) => mapRecentTransactions(result.data || [], payeeMap)).catch(() => []);
}

export async function getUpcomingBills(userId) {
  const { schedules, payeeMap, recentTransactions } = await getMetadata(userId);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

  return mapUpcomingBills(schedules, payeeMap, recentTransactions, { today, weekFromNow });
}

export function getCalendarBillsRange(userId, { start, end }) {
  return withLock(async () => {
    return withActualBudget(userId, async ({ serverURL }) => {
      const [rawPayees, schedules] = await Promise.all([
        actualApi.getPayees(),
        getSchedulesWithConditions(),
      ]);

      const payeeMap = Object.fromEntries(rawPayees.map(p => [p.id, p.name]));
      const classifiedSchedules = classifySchedules(schedules, rawPayees);
      const billSchedules = filterBillSchedulesForRange(classifiedSchedules, { start, end });
      const recentTransactions = await getRecentTransactionsForSchedules(billSchedules, payeeMap);

      return {
        schedules: mapOpenBillInstances(billSchedules, payeeMap, { start, end, recentTransactions }),
        recentTransactions,
        payeeMap,
        actualBudgetUrl: serverURL,
      };
    });
  });
}

export function markBillPaid(scheduleId, userId) {
  return withLock(async () => {
    return withActualBudget(userId, async () => {
      await actualApi.internal.send("schedule/post-transaction", { id: scheduleId });
      await actualApi.sync();
      clearMetadataCache();
      return { success: true };
    });
  });
}

export function sendBill(billData, userId) {
  return withLock(async () => {
    return withActualBudget(userId, async () => {
      const accounts = await actualApi.getAccounts();

      // Use user-selected account if provided, otherwise auto-detect
      const resolveAccount = () => {
        if (billData.account_id) {
          const selected = accounts.find((a) => a.id === billData.account_id);
          if (selected) return selected;
        }
        return accounts.find((a) => a.type === "checking" || a.name.toLowerCase().includes("checking")) || accounts[0];
      };

      const targetAccount = resolveAccount();
      const amountCents = Math.round(billData.amount * 100);
      const isIncome = billData.type === "income";

      let result;

      if (billData.type === "transfer") {
        // Transfer: use from/to account IDs for schedule upsert
        if (!billData.from_account_id || !billData.to_account_id || !billData.schedule_name) {
          const err = new Error("Transfer requires from_account_id, to_account_id, and schedule_name");
          err.status = 400;
          throw err;
        }
        result = await upsertTransferSchedule(billData);
      } else if (billData.type === "bill") {
        // Bill: upsert schedule with category
        result = await upsertSchedule(billData, targetAccount.id);
      } else {
        // Expense / Income: one-time transaction (existing behavior + category support)
        const txn = {
          date: billData.due_date,
          amount: isIncome ? amountCents : -amountCents,
          payee_name: billData.payee,
          notes: billData.notes == null || String(billData.notes).trim() === ""
            ? ""
            : String(billData.notes),
        };
        if (billData.category_id) txn.category = billData.category_id;
        await actualApi.addTransactions(targetAccount.id, [txn]);
        result = { success: true, message: `Sent ${billData.payee} $${billData.amount} to Actual Budget` };
      }

      await actualApi.sync();
      clearMetadataCache();
      return result;
    });
  });
}

// One-shot transaction post for mobile shortcuts (Tap-to-Pay). Resolves account
// and optional category by name, then writes a single cleared=false transaction.
export function createQuickTxn(userId, { accountName, amount, payee, type = "payment", date, notes, categoryName }) {
  return withLock(async () => {
    if (!accountName || amount == null || !payee) {
      const e = new Error("accountName, amount, and payee are required");
      e.status = 400;
      throw e;
    }

    const meta = await getMetadataInner(userId);
    const acct = meta.accounts.find(a => a.name.toLowerCase() === String(accountName).toLowerCase());
    if (!acct) {
      const e = new Error(`Account "${accountName}" not found in Actual Budget`);
      e.status = 404;
      throw e;
    }

    let categoryId = null;
    if (categoryName) {
      for (const group of meta.categories) {
        const match = group.categories.find(c => c.name.toLowerCase() === String(categoryName).toLowerCase());
        if (match) { categoryId = match.id; break; }
      }
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const txnDate = date || today;
    const amountCents = Math.round(Math.abs(Number(amount)) * 100);
    const signed = type === "deposit" ? amountCents : -amountCents;

    return withActualBudget(userId, async () => {
      const txn = {
        date: txnDate,
        amount: signed,
        payee_name: payee,
        notes: notes || "Tap-to-Pay",
        cleared: false,
      };
      if (categoryId) txn.category = categoryId;

      await actualApi.addTransactions(acct.id, [txn]);
      await actualApi.sync();

      // Invalidate cached recentTransactions so bill-paid detection sees this txn
      clearMetadataCache();

      return {
        success: true,
        account: acct.name,
        payee,
        amount: Math.abs(Number(amount)),
        type,
        date: txnDate,
        category: categoryName || null,
      };
    });
  });
}

export const __testing__ = {
  mapOpenBillInstances,
  closeActualSession,
  resetBackupPruneThrottle,
};
