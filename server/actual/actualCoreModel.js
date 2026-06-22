// Pure derivation over Actual SDK data for the in-process SDK path (actual-core.js):
// schedule classification + matching, schedule-condition building, date helpers, and
// the metadata/bill projections. No @actual-app/api, no DB — the residual owns the SDK
// session lifecycle, the lock/cache singletons, and all IO.
import { amountConditionCents } from "./actual-amount-condition.js";
import { buildBillOccurrencesFromSchedules, isSchedulePaid } from "./actual-bill-occurrences.js";

export function actualSessionKey(config) {
  return JSON.stringify({
    serverURL: config.serverURL,
    password: config.password || "",
    syncId: config.syncId,
    dataDir: config.dataDir || "",
    localBudgetId: config.localBudgetId || "",
  });
}

export function classifySchedules(schedules, rawPayees) {
  const transferPayeeIds = new Set(rawPayees.filter(p => p.transfer_acct).map(p => p.id));
  return schedules.map(s => {
    const payeeId = s.conditions?.find(c => c.field === "payee")?.value;
    const amtCond = s.conditions?.find(c => c.field === "amount");
    const signedAmt = amountConditionCents(amtCond);
    let type;
    if (transferPayeeIds.has(payeeId)) type = "transfer";
    else if (signedAmt > 0) type = "income";
    else type = "bill";
    return { ...s, type };
  });
}

export function findScheduleByPayee(schedules, payeeId, accountId, amountCents) {
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

export function buildDateCondition(oldConditions, newDueDate) {
  const dateCond = oldConditions.find(c => c.field === "date");
  if (dateCond && typeof dateCond.value === "object" && dateCond.value?.frequency) {
    if (dateCond.value.interval > 1) {
      return dateCond; // Keep complex recurrence as-is
    }
    return { op: dateCond.op, field: "date", value: { ...dateCond.value, start: newDueDate } };
  }
  return { op: "is", field: "date", value: newDueDate };
}

export function addDaysYmd(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mapOpenBillInstances(schedules, payeeMap, range) {
  return buildBillOccurrencesFromSchedules(schedules, {
    payeeMap,
    recentTransactions: range.recentTransactions || [],
    range,
  });
}

export function transactionSearchStart(schedules) {
  const dates = schedules
    .map((schedule) => schedule.next_date)
    .filter(Boolean)
    .sort();
  if (!dates.length) return null;
  return addDaysYmd(dates[0], -14);
}

// Map raw SDK transaction rows to the { payee, amount, date } shape for client-side
// bill cross-reference. Shared by the metadata projection and the calendar bill range.
export function mapRecentTransactions(rawTxns, payeeMap) {
  return rawTxns
    .filter(t => t.payee && t.amount)
    .map(t => ({
      payee: payeeMap[t.payee] || "",
      payeeId: t.payee,
      amount: Math.abs(t.amount) / 100,
      date: t.date,
      scheduleId: t.schedule || null,
    }));
}

// Pure projection of the raw SDK metadata pulls (accounts, payees, category groups,
// schedules-with-conditions, recent transactions) into the cached metadata shape.
export function projectSdkMetadata({ rawAccounts, rawPayees, groups, schedules, recentTxns }) {
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
  const classifiedSchedules = classifySchedules(schedules, rawPayees);

  const categories = groups
    .filter(g => g.name !== "Internal")
    .map(g => ({
      group_name: g.name,
      categories: (g.categories || []).map(c => ({ id: c.id, name: c.name })),
    }));

  const recentTransactions = mapRecentTransactions(recentTxns, payeeMap);

  return { accounts, payees, payeeMap, categories, schedules: classifiedSchedules, recentTransactions };
}

// Pure projection of classified schedules into the upcoming-bills view: filters to
// non-income schedules due within the week, derives amount/payee/paid, and sorts by date.
export function mapUpcomingBills(schedules, payeeMap, recentTransactions, { today, weekFromNow }) {
  return schedules
    .filter(s => s.next_date && s.next_date <= weekFromNow)
    .filter(s => s.type !== "income")
    .map(s => {
      const amtCond = s.conditions.find(c => c.field === "amount");
      const payeeCond = s.conditions.find(c => c.field === "payee");
      const amountCents = amountConditionCents(amtCond);
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
