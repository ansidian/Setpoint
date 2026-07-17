import {
  isBillsMirrorMaintenanceDue,
  readBillsMirrorRange,
  scheduleBillsMirrorRefresh,
  shouldScheduleImmediateBillsRefresh,
} from "../bills/bills-service.ts";
import { requestBillsCurrentMaintenanceRefresh } from "../dashboard/current-service.ts";
import { queryTransactions } from "../transactions/transactions-service.ts";
import type { ActualDateRange } from "../../shared/types/actual.ts";

interface CalendarBillsRangeError {
  source: "transactions";
  message: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const CALENDAR_TRANSACTION_LIMIT = 5000;

export async function readCalendarBillsRange(userId: string, range: ActualDateRange) {
  const errors: CalendarBillsRangeError[] = [];
  const data = await readBillsMirrorRange(userId, { start: range.start, end: range.end });
  const transactionData = await queryTransactions(userId, {
    start: range.start,
    end: range.end,
    direction: "all",
    limit: CALENDAR_TRANSACTION_LIMIT,
  });
  if (transactionData.error) {
    errors.push({ source: "transactions", message: transactionData.error });
  }

  if (data.syncHealth?.state === "needs_sync") {
    if (shouldScheduleImmediateBillsRefresh(data.syncHealth)) {
      scheduleBillsMirrorRefresh(userId).catch((err: unknown) => {
        console.error("[Calendar] bills mirror refresh scheduling failed:", errorMessage(err));
      });
    }
  } else if (isBillsMirrorMaintenanceDue(data.syncHealth)) {
    requestBillsCurrentMaintenanceRefresh(userId, { now: new Date() }).catch((err: unknown) => {
      console.error("[Calendar] bills mirror maintenance refresh scheduling failed:", errorMessage(err));
    });
  }

  return {
    ...data,
    recentTransactions: undefined,
    transactions: transactionData.transactions || [],
    transactionsTruncated: !!transactionData.truncated,
    errors,
  };
}
