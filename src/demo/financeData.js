import { demoDateRange } from "./dateRange.js";

export function buildDemoTransactions(todayKey, yesterdayKey) {
  return [
    { id: "demo-txn-payroll", date: todayKey, amount: 4200, direction: "income", payee: "Northstar Payroll", category: "Income", account: "Demo Checking", notes: "Demo direct deposit" },
    { id: "demo-txn-market", date: todayKey, amount: 68.42, direction: "expense", payee: "Corner Market", category: "Groceries", account: "Demo Checking", notes: "Demo grocery run" },
    { id: "demo-txn-refund", date: yesterdayKey, amount: 34.99, direction: "income", payee: "Cloud Sandbox", category: "Refunds", account: "Demo Checking", notes: "Demo service credit" },
    { id: "demo-txn-coffee", date: yesterdayKey, amount: 6.75, direction: "expense", payee: "Signal Coffee", category: "Dining", account: "Demo Card", notes: "Demo coffee" },
  ];
}

export function buildDemoCalendarBillsRange(seed, url) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  return {
    schedules: demoDateRange(seed.bills, start, end, (item) => item.next_date),
    transactions: demoDateRange(seed.transactions, start, end, (item) => item.date),
    transactionsTruncated: false,
    payeeMap: structuredClone(seed.currentDashboard.payeeMap),
    actualBudgetUrl: seed.currentDashboard.actualBudgetUrl,
    syncHealth: structuredClone(seed.currentDashboard.billsSyncHealth),
  };
}
