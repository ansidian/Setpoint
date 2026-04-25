import actualApi from "@actual-app/api";
import { decrypt } from "./encryption.js";
import db from "../db/connection.js";

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

function withLock(fn) {
  const result = lock.then(() => fn());
  lock = result.catch(() => {});
  return result;
}

// --- Metadata cache: 5-minute TTL ---
const METADATA_TTL_MS = 5 * 60 * 1000;
let metadataCache = { data: null, ts: 0 };

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
      await actualApi.shutdown().catch(() => {});
      return {
        success: true,
        budgetCount: budgets.length,
        budgetFound: found,
      };
    } catch (err) {
      await actualApi.shutdown().catch(() => {});
      throw err;
    }
  });
}

// Fetch all Actual Budget metadata in a single connection (accounts, payees, categories)
// The @actual-app/api is a singleton — parallel init/shutdown calls conflict,
// so we batch everything into one connection.
// Cache check is inside withLock to prevent cache stampede (D-03 from RESEARCH.md).
export function getMetadata(userId) {
  return withLock(() => getMetadataInner(userId));
}

// Inner body — assumes caller already holds the withLock mutex. Lets operations
// like createQuickTxn chain metadata fetch + mutation inside one critical section
// without re-entering the lock (which would serialize against itself).
async function getMetadataInner(userId) {
    const now = Date.now();
    if (metadataCache.data && now - metadataCache.ts < METADATA_TTL_MS) {
      return metadataCache.data;
    }

    const { serverURL, password, syncId } = await getActualConfig(userId);
    try {
      await actualApi.init({ serverURL, password });
      await actualApi.downloadBudget(syncId);

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

      const accounts = rawAccounts
        .filter(a => !a.closed)
        .map(a => ({ id: a.id, name: a.name, type: a.type }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const payees = rawPayees
        .filter(p => p.name && !p.transfer_acct)
        .map(p => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const payeeMap = Object.fromEntries(rawPayees.map(p => [p.id, p.name]));

      // Classify each schedule as bill / transfer / income so the calendar can
      // hide income (paychecks) and style transfers distinctly. Transfer payees
      // (Actual's special per-account payees) carry a non-null transfer_acct.
      const transferPayeeIds = new Set(rawPayees.filter(p => p.transfer_acct).map(p => p.id));
      const classifiedSchedules = schedules.map(s => {
        const payeeId = s.conditions?.find(c => c.field === "payee")?.value;
        const amtCond = s.conditions?.find(c => c.field === "amount");
        const rawAmt = amtCond?.value;
        const signedAmt = typeof rawAmt === "object" && rawAmt !== null
          ? (rawAmt.num1 ?? 0)
          : (rawAmt ?? 0);
        let type;
        if (transferPayeeIds.has(payeeId)) type = "transfer";
        else if (signedAmt > 0) type = "income";
        else type = "bill";
        return { ...s, type };
      });

      const categories = groups
        .filter(g => g.name !== "Internal")
        .map(g => ({
          group_name: g.name,
          categories: (g.categories || []).map(c => ({ id: c.id, name: c.name })),
        }));

      // Map recent transactions to { payee, amount, date } for client-side bill cross-reference
      const recentTransactions = recentTxns
        .filter(t => t.payee && t.amount)
        .map(t => ({
          payee: payeeMap[t.payee] || "",
          payeeId: t.payee,
          amount: Math.abs(t.amount) / 100,
          date: t.date,
          scheduleId: t.schedule || null,
        }));

      const result = { accounts, payees, payeeMap, categories, schedules: classifiedSchedules, recentTransactions };
      metadataCache = { data: result, ts: Date.now() };
      return result;
    } finally {
      await actualApi.shutdown().catch(() => {});
    }
}

// Individual accessors (used by briefing generation where only one is needed)
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

function findScheduleByPayee(schedules, payeeId, accountId, amountCents) {
  const matches = schedules.filter(s =>
    s.conditions.some(c => c.field === 'payee' && c.value === payeeId)
  );
  if (matches.length === 0) return null;

  // Transfers share a single payee (the transfer-payee of from_account), so a
  // single payee-match is NOT sufficient — it may belong to a different card.
  // Account must dominate even when matches.length === 1, otherwise creating a
  // new CC transfer schedule silently rewrites the one existing one.
  const acctMatches = accountId
    ? matches.filter(s => s.conditions.some(c => c.field === 'account' && c.value === accountId))
    : matches;
  if (acctMatches.length === 0) return null;
  if (acctMatches.length === 1) return acctMatches[0];

  for (const s of acctMatches) {
    const amtCond = s.conditions.find(c => c.field === 'amount');
    if (!amtCond || !amountCents) return s;

    const amt = Math.abs(amountCents);
    if (amtCond.op === 'is' && Math.abs(amtCond.value) === amt) return s;
    if (amtCond.op === 'isapprox' && Math.abs(Math.abs(amtCond.value) - amt) / amt < 0.3) return s;
    if (amtCond.op === 'isbetween') {
      const lo = Math.min(Math.abs(amtCond.value.num1), Math.abs(amtCond.value.num2));
      const hi = Math.max(Math.abs(amtCond.value.num1), Math.abs(amtCond.value.num2));
      if (amt >= lo * 0.7 && amt <= hi * 1.3) return s;
    }
  }
  return acctMatches[0];
}

async function resolvePayee(payeeName) {
  if (!payeeName) return null;
  const payees = await actualApi.getPayees();
  const match = payees.find(p => p.name?.toLowerCase() === payeeName.toLowerCase());
  return match ? match.id : await actualApi.createPayee({ name: payeeName });
}

// --- Shared schedule helpers ---

function buildDateCondition(oldConditions, newDueDate) {
  const dateCond = oldConditions.find(c => c.field === "date");
  if (dateCond && typeof dateCond.value === "object" && dateCond.value?.frequency) {
    if (dateCond.value.interval > 1) {
      return dateCond; // Keep complex recurrence as-is
    }
    return { op: dateCond.op, field: "date", value: { ...dateCond.value, start: newDueDate } };
  }
  return { op: "is", field: "date", value: newDueDate };
}

async function findExistingSchedule(payeeId, accountId, amount, name) {
  if (payeeId) {
    const schedules = await getSchedulesWithConditions();
    const existing = findScheduleByPayee(schedules, payeeId, accountId, Math.abs(amount));
    if (existing) return existing.id;
  }
  if (name) {
    const allSchedules = await getSchedulesWithConditions({ includeCompleted: true });
    const byName = allSchedules.find(s => s.name === name);
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
  const byName = allSchedules.find(s => s.name === name);
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

function daysBetweenYmd(a, b) {
  const ms = new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function isSchedulePaid(schedule, recentTransactions) {
  if (!schedule.next_date) return false;
  const amtCond = schedule.conditions?.find(c => c.field === "amount");
  const payeeCond = schedule.conditions?.find(c => c.field === "payee");
  const payeeId = payeeCond?.value;
  const amount = Math.abs(amtCond?.value ?? 0) / 100;
  return recentTransactions.some(t => {
    const dayDiff = Math.abs(daysBetweenYmd(t.date, schedule.next_date));
    if (t.scheduleId && t.scheduleId === schedule.id) return dayDiff <= 14;
    if (!payeeId || t.payeeId !== payeeId) return false;
    if (Math.abs(t.amount - amount) > 0.01) return false;
    return dayDiff <= 3;
  });
}

export async function getUpcomingBills(userId) {
  const { schedules, payeeMap, recentTransactions } = await getMetadata(userId);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

  return schedules
    .filter(s => s.next_date && s.next_date <= weekFromNow)
    .filter(s => s.type !== "income")
    .map(s => {
      const amtCond = s.conditions.find(c => c.field === "amount");
      const payeeCond = s.conditions.find(c => c.field === "payee");
      const rawAmt = amtCond?.value;
      const amountCents = typeof rawAmt === "object" && rawAmt !== null ? (rawAmt.num1 ?? 0) : (rawAmt ?? 0);
      const payeeName = payeeCond ? payeeMap[payeeCond.value] : s.name;

      return {
        id: s.id,
        name: s.name || payeeName || "Unknown",
        payee: payeeName || s.name || "Unknown",
        amount: Math.abs(amountCents) / 100,
        next_date: s.next_date,
        isDueToday: s.next_date === today,
        isOverdue: s.next_date < today,
        paid: isSchedulePaid(s, recentTransactions),
        type: s.type || "bill",
      };
    })
    .sort((a, b) => a.next_date.localeCompare(b.next_date));
}

export function markBillPaid(scheduleId, userId) {
  return withLock(async () => {
    const { serverURL, password, syncId } = await getActualConfig(userId);
    try {
      await actualApi.init({ serverURL, password });
      await actualApi.downloadBudget(syncId);
      await actualApi.internal.send("schedule/post-transaction", { id: scheduleId });
      await actualApi.sync();
      metadataCache = { data: null, ts: 0 };
      return { success: true };
    } finally {
      await actualApi.shutdown().catch(() => {});
    }
  });
}

export function sendBill(billData, userId) {
  return withLock(async () => {
    const { serverURL, password, syncId } = await getActualConfig(userId);

    try {
      await actualApi.init({ serverURL, password });
      await actualApi.downloadBudget(syncId);

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
          notes: billData.notes || `Auto-detected ${billData.type} from EA briefing`,
        };
        if (billData.category_id) txn.category = billData.category_id;
        await actualApi.addTransactions(targetAccount.id, [txn]);
        result = { success: true, message: `Sent ${billData.payee} $${billData.amount} to Actual Budget` };
      }

      await actualApi.sync();
      return result;
    } finally {
      await actualApi.shutdown().catch(() => {});
    }
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

    const { serverURL, password, syncId } = await getActualConfig(userId);
    try {
      await actualApi.init({ serverURL, password });
      await actualApi.downloadBudget(syncId);

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
      metadataCache = { data: null, ts: 0 };

      return {
        success: true,
        account: acct.name,
        payee,
        amount: Math.abs(Number(amount)),
        type,
        date: txnDate,
        category: categoryName || null,
      };
    } finally {
      await actualApi.shutdown().catch(() => {});
    }
  });
}
