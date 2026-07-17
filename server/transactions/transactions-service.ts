import { readTransactionsRange } from "../actual/actual-transactions-read.ts";
import { getBillsMirrorState } from "../bills/bills-mirror-sync.js";
import type {
  TransactionFilters,
  TransactionGroupBy,
  TransactionQueryResult,
  TransactionReadResult,
  TransactionRecord,
  TransactionSummaryBucket,
  TransactionSummaryResult,
} from "../../shared/types/transactions.ts";

interface MirrorStateResult {
  syncHealth?: { state?: string };
}
type MirrorStateReader = (userId: string) => Promise<MirrorStateResult>;
type TransactionRangeReader = (userId: string, filters: TransactionFilters) => Promise<TransactionReadResult>;
interface TransactionDependencies {
  readRange?: TransactionRangeReader;
  mirrorState?: MirrorStateReader;
}
interface TransactionReadOutcome {
  data?: TransactionReadResult;
  error?: string;
}

const SUMMARY_SCAN_CAP = 50_000;
const SUMMARY_TOP_N = 15;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function safeSyncState(userId: string, mirrorState: MirrorStateReader): Promise<string | null> {
  try {
    const { syncHealth } = await mirrorState(userId);
    if (syncHealth?.state && syncHealth.state !== "current") return syncHealth.state;
  } catch {
    // best-effort: freshness is a caveat, not a hard dependency
  }
  return null;
}

async function readOrError(userId: string, filters: TransactionFilters, readRange: TransactionRangeReader): Promise<TransactionReadOutcome> {
  try {
    return { data: await readRange(userId, filters) };
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "status" in err && err.status === 503) return { error: "transactions unavailable — budget not synced" };
    console.error("[Transactions] read failed:", err instanceof Error ? err.message : err);
    return { error: "could not read transactions" };
  }
}

export async function queryTransactions(userId: string, filters: TransactionFilters, {
  readRange = readTransactionsRange,
  mirrorState = getBillsMirrorState,
}: TransactionDependencies = {}): Promise<TransactionQueryResult> {
  const { data, error } = await readOrError(userId, filters, readRange);
  if (error) return { error };
  if (!data) return { error: "could not read transactions" };
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

function bucketLabel(txn: TransactionRecord, groupBy: TransactionGroupBy): string {
  if (groupBy === "payee") return txn.payee || "Unknown";
  if (groupBy === "month") return String(txn.date || "").slice(0, 7);
  return txn.category || "Uncategorized";
}

function aggregate(transactions: TransactionRecord[], groupBy: TransactionGroupBy): { buckets: TransactionSummaryBucket[]; total: number } {
  const map = new Map<string, TransactionSummaryBucket>();
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

export async function summarizeTransactions(userId: string, {
  start, end, group_by = "category", payee, category, account, notes, direction = "expense",
}: TransactionFilters & { group_by?: string }, {
  readRange = readTransactionsRange,
  mirrorState = getBillsMirrorState,
}: TransactionDependencies = {}): Promise<TransactionSummaryResult> {
  const groupBy: TransactionGroupBy = group_by === "payee" || group_by === "month" ? group_by : "category";
  const { data, error } = await readOrError(
    userId,
    { start, end, payee, category, account, notes, direction, limit: SUMMARY_SCAN_CAP },
    readRange,
  );
  if (error) return { error };
  if (!data) return { error: "could not read transactions" };
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
