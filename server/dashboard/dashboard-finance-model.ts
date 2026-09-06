import type { DashboardSpendingSnapshot } from "../../shared/types/dashboard-finance.ts";
import type { TransactionRecord } from "../../shared/types/transactions.ts";

export function emptySpendingSnapshot(now: Date): DashboardSpendingSnapshot {
  // Match the existing dashboard/calendar day boundary, independent of server timezone.
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
  const previousMonth = previousMonthEnd.toISOString().slice(0, 7);
  const previousDay = Math.min(day, previousMonthEnd.getUTCDate());
  return {
    status: "unavailable",
    current: { start: `${today.slice(0, 7)}-01`, end: today, total: null },
    previous: { start: `${previousMonth}-01`, end: `${previousMonth}-${String(previousDay).padStart(2, "0")}`, total: null },
    previousPeriodClamped: previousDay !== day,
    categories: [], changeAmount: null, changePercent: null,
    syncState: null, lastSyncedAt: null, error: null,
  };
}

export function summarizeDashboardSpending(snapshot: DashboardSpendingSnapshot, rows: TransactionRecord[]): DashboardSpendingSnapshot {
  let currentCents = 0;
  let previousCents = 0;
  const categories = new Map<string, { cents: number; count: number }>();
  for (const row of rows) {
    if (row.direction !== "expense" || row.transferAccountId) continue;
    const cents = Math.round(row.amount * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) continue;
    if (row.date >= snapshot.current.start && row.date <= snapshot.current.end) {
      currentCents += cents;
      const label = row.category || "Uncategorized";
      const category = categories.get(label) || { cents: 0, count: 0 };
      category.cents += cents;
      category.count += 1;
      categories.set(label, category);
    } else if (row.date >= snapshot.previous.start && row.date <= snapshot.previous.end) {
      previousCents += cents;
    }
  }
  return {
    ...snapshot,
    status: "ready", error: null,
    current: { ...snapshot.current, total: currentCents / 100 },
    previous: { ...snapshot.previous, total: previousCents / 100 },
    categories: [...categories].sort((a, b) => b[1].cents - a[1].cents || a[0].localeCompare(b[0]))
      .slice(0, 3).map(([label, value]) => ({ label, amount: value.cents / 100, count: value.count })),
    changeAmount: (currentCents - previousCents) / 100,
    changePercent: previousCents > 0
      ? Math.sign(currentCents - previousCents) * Math.round(Math.abs(currentCents - previousCents) / previousCents * 1000) / 10
      : null,
  };
}
