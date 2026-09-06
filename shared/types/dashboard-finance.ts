import type { TransactionImportRunSummary } from "./transaction-imports.ts";

export interface DashboardSpendingPeriod {
  start: string;
  end: string;
  total: number | null;
}

export interface DashboardSpendingSnapshot {
  status: "ready" | "unavailable";
  current: DashboardSpendingPeriod;
  previous: DashboardSpendingPeriod;
  previousPeriodClamped: boolean;
  categories: Array<{ label: string; amount: number; count: number }>;
  changeAmount: number | null;
  changePercent: number | null;
  syncState: string | null;
  lastSyncedAt: string | null;
  error: string | null;
}

export interface DashboardFinanceActivityItem {
  id: string;
  runId: string;
  emailUid: string;
  payee: string | null;
  amountCents: number | null;
  currency: string | null;
  status: "needs_review" | "ready" | "failed" | "paused" | "added" | "updated" | "already_present";
  description: string;
  /** Last durable update; the import store does not retain an item completion timestamp. */
  updatedAt: number;
}

export interface DashboardFinanceActivity {
  status: "ready" | "unavailable";
  reviewCount: number;
  review: DashboardFinanceActivityItem[];
  recent: DashboardFinanceActivityItem[];
  error: string | null;
}

export interface DashboardFinanceResponse {
  fetchedAt: string;
  spending: DashboardSpendingSnapshot;
  activity: DashboardFinanceActivity;
}

export interface DashboardFinanceReviewRunsResponse {
  runs: TransactionImportRunSummary[];
  total: number;
  offset: number;
}
