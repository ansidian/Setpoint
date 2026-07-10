import {
  isBillsMirrorMaintenanceDue,
  readBillsMirrorRange,
  scheduleBillsMirrorRefresh,
  shouldScheduleImmediateBillsRefresh,
} from "../bills/bills-service.js";
import { requestBillsCurrentMaintenanceRefresh } from "../dashboard/current-service.js";
import { queryTransactions } from "../transactions/transactions-service.js";

const CALENDAR_TRANSACTION_LIMIT = 5000;

export async function readCalendarBillsRange(userId, range) {
  const errors = [];
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
      scheduleBillsMirrorRefresh(userId).catch((err) => {
        console.error("[Calendar] bills mirror refresh scheduling failed:", err.message);
      });
    }
  } else if (isBillsMirrorMaintenanceDue(data.syncHealth)) {
    requestBillsCurrentMaintenanceRefresh(userId, { now: new Date() }).catch((err) => {
      console.error("[Calendar] bills mirror maintenance refresh scheduling failed:", err.message);
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
