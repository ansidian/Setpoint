import type { DashboardFinanceResponse } from "../../shared/types/dashboard-finance";
import type { DemoSeed } from "./store";
import { getDemoFinanceActivity } from "./transactionImports";

/** Fictional values derive from the same refresh-reset transactions as Calendar. */
export function buildDemoDashboardFinance(seed: DemoSeed): DashboardFinanceResponse {
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const day = Number(today.slice(8));
  const previousMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0));
  const priorMonth = previousMonthEnd.toISOString().slice(0, 7);
  const current = { start: `${today.slice(0, 7)}-01`, end: today, total: 0 };
  const previous = { start: `${priorMonth}-01`, end: `${priorMonth}-${String(Math.min(day, previousMonthEnd.getUTCDate())).padStart(2, "0")}`, total: 0 };
  const buckets = new Map<string, { label: string; amount: number; count: number }>();
  for (const tx of seed.transactions) {
    if (tx.direction !== "expense") continue;
    if (tx.date >= current.start && tx.date <= current.end) {
      current.total += tx.amount;
      const bucket = buckets.get(tx.category) || { label: tx.category, amount: 0, count: 0 };
      bucket.amount += tx.amount; bucket.count += 1;
      buckets.set(tx.category, bucket);
    } else if (tx.date >= previous.start && tx.date <= previous.end) previous.total += tx.amount;
  }
  current.total = Math.round(current.total * 100) / 100;
  previous.total = Math.round(previous.total * 100) / 100;
  const changeAmount = Math.round((current.total - previous.total) * 100) / 100;
  return {
    fetchedAt: now.toISOString(),
    spending: { status: "ready", current, previous, previousPeriodClamped: day > previousMonthEnd.getUTCDate(),
      categories: [...buckets.values()].sort((a, b) => b.amount - a.amount).slice(0, 3), changeAmount,
      changePercent: previous.total > 0 ? Math.round(changeAmount / previous.total * 1000) / 10 : null,
      syncState: "current", lastSyncedAt: now.toISOString(), error: null },
    activity: getDemoFinanceActivity(),
  };
}
