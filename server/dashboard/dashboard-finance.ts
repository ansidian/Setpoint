import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import { readTransactionsRange } from "../actual/actual.ts";
import { getBillsMirrorState } from "../bills/bills-service.ts";
import { createTransactionImportStore } from "../transaction-imports/transaction-import-store.ts";
import type { DashboardFinanceResponse } from "../../shared/types/dashboard-finance.ts";
import { emptySpendingSnapshot, summarizeDashboardSpending } from "./dashboard-finance-model.ts";

interface DashboardFinanceOptions {
  now?: Date;
  dbClient?: Pick<Client, "execute" | "batch">;
  actualReadOptions?: Parameters<typeof readTransactionsRange>[2];
}

/** Local reads only: no provider refresh, SDK startup, or automation admission. */
export async function getDashboardFinance(userId: string, {
  now = new Date(), dbClient = db, actualReadOptions,
}: DashboardFinanceOptions = {}): Promise<DashboardFinanceResponse> {
  const spending = emptySpendingSnapshot(now);
  const [transactions, mirror, activity] = await Promise.allSettled([
    readTransactionsRange(userId, {
      start: spending.previous.start, end: spending.current.end,
      direction: "expense", includeTransfers: false, limit: 50_000,
    }, { ...actualReadOptions, localOnly: true }),
    getBillsMirrorState(userId, { dbClient }),
    createTransactionImportStore(dbClient).readDashboardActivity(userId),
  ]);
  if (mirror.status === "fulfilled") {
    spending.syncState = mirror.value.syncHealth.state;
    spending.lastSyncedAt = mirror.value.syncHealth.lastSuccessAt ?? null;
  }
  let result = spending;
  if (transactions.status === "fulfilled" && !transactions.value.truncated && !transactions.value.unknownFilter) {
    result = summarizeDashboardSpending(spending, transactions.value.transactions || []);
  } else {
    spending.error = transactions.status === "fulfilled" && transactions.value.truncated
      ? "Spending unavailable: the transaction range exceeds the read limit."
      : "Spending unavailable. Check the Actual connection and budget sync.";
  }
  return {
    fetchedAt: now.toISOString(), spending: result,
    activity: activity.status === "fulfilled" ? activity.value : {
      status: "unavailable", reviewCount: 0, review: [], recent: [],
      error: "Finance activity is temporarily unavailable.",
    },
  };
}
