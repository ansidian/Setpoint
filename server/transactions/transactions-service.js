import { readTransactionsRange } from "../actual/actual-transactions-read.js";
import { getBillsMirrorState } from "../bills/bills-mirror-sync.js";

const SUMMARY_SCAN_CAP = 50_000;
const SUMMARY_TOP_N = 15;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function safeSyncState(userId, mirrorState) {
  try {
    const { syncHealth } = await mirrorState(userId);
    if (syncHealth?.state && syncHealth.state !== "current") return syncHealth.state;
  } catch {
    // best-effort: freshness is a caveat, not a hard dependency
  }
  return null;
}

async function readOrError(userId, filters, readRange) {
  try {
    return { data: await readRange(userId, filters) };
  } catch (err) {
    if (err?.status === 503) return { error: "transactions unavailable — budget not synced" };
    console.error("[Transactions] read failed:", err?.message || err);
    return { error: "could not read transactions" };
  }
}

export async function queryTransactions(userId, filters, {
  readRange = readTransactionsRange,
  mirrorState = getBillsMirrorState,
} = {}) {
  const { data, error } = await readOrError(userId, filters, readRange);
  if (error) return { error };
  if (data.unknownFilter) return { total: 0, unknown_filter: data.unknownFilter };
  const transactions = data.transactions || [];
  const sync = await safeSyncState(userId, mirrorState);
  return {
    total: transactions.length,
    truncated: !!data.truncated,
    transactions,
    ...(sync ? { sync_state: sync } : {}),
  };
}

function bucketLabel(txn, groupBy) {
  if (groupBy === "payee") return txn.payee || "Unknown";
  if (groupBy === "month") return String(txn.date || "").slice(0, 7);
  return txn.category || "Uncategorized";
}

function aggregate(transactions, groupBy) {
  const map = new Map();
  let total = 0;
  for (const txn of transactions) {
    const amount = Number(txn.amount) || 0;
    total += amount;
    const label = bucketLabel(txn, groupBy);
    const cur = map.get(label) || { label, amount: 0, count: 0 };
    cur.amount += amount;
    cur.count += 1;
    map.set(label, cur);
  }
  const sorted = [...map.values()].sort((a, b) => b.amount - a.amount);
  const buckets = sorted.slice(0, SUMMARY_TOP_N).map((b) => ({ ...b, amount: round2(b.amount) }));
  const rest = sorted.slice(SUMMARY_TOP_N);
  if (rest.length) {
    buckets.push({
      label: "Other",
      amount: round2(rest.reduce((s, b) => s + b.amount, 0)),
      count: rest.reduce((s, b) => s + b.count, 0),
    });
  }
  return { buckets, total: round2(total) };
}

export async function summarizeSpending(userId, {
  start, end, group_by = "category", payee, category, account, notes,
}, {
  readRange = readTransactionsRange,
  mirrorState = getBillsMirrorState,
} = {}) {
  const groupBy = ["category", "payee", "month"].includes(group_by) ? group_by : "category";
  const { data, error } = await readOrError(
    userId,
    { start, end, payee, category, account, notes, limit: SUMMARY_SCAN_CAP },
    readRange,
  );
  if (error) return { error };
  if (data.unknownFilter) return { total: 0, unknown_filter: data.unknownFilter };
  const { buckets, total } = aggregate(data.transactions || [], groupBy);
  const sync = await safeSyncState(userId, mirrorState);
  return {
    total,
    period: { start, end },
    group_by: groupBy,
    buckets,
    ...(sync ? { sync_state: sync } : {}),
  };
}
