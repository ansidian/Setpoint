import { demoDateRange } from "./dateRange.ts";
import type { DemoSeed } from "./store.ts";
import type { TransactionImportItem } from "../../shared/types/transaction-imports.ts";

export function buildDemoTransactions(todayKey: string, yesterdayKey: string) {
  const priorMonth = new Date(`${todayKey.slice(0, 7)}-01T12:00:00Z`);
  priorMonth.setUTCMonth(priorMonth.getUTCMonth() - 1);
  const priorDate = priorMonth.toISOString().slice(0, 10);
  return [
    { id: "demo-txn-payroll", date: todayKey, amount: 4200, direction: "income", payee: "Northstar Payroll", category: "Income", account: "Demo Checking", notes: "Demo direct deposit" },
    { id: "demo-txn-market", date: todayKey, amount: 68.42, direction: "expense", payee: "Corner Market", category: "Groceries", account: "Demo Checking", notes: "Demo grocery run" },
    { id: "demo-txn-refund", date: yesterdayKey, amount: 34.99, direction: "income", payee: "Cloud Sandbox", category: "Refunds", account: "Demo Checking", notes: "Demo service credit" },
    { id: "demo-txn-coffee", date: yesterdayKey, amount: 6.75, direction: "expense", payee: "Signal Coffee", category: "Dining", account: "Demo Card", notes: "Demo coffee" },
    { id: "demo-transaction-item-automatic", date: todayKey, amount: 38.47, direction: "expense", payee: "Cloud Sandbox", category: "Cloud Services", account: "Demo Checking", notes: "Fictional automatically imported PayPal receipt" },
    { id: "demo-txn-prior-market", date: priorDate, amount: 88, direction: "expense", payee: "Corner Market", category: "Groceries", account: "Demo Checking", notes: "Fictional prior-month groceries" },
    { id: "demo-txn-prior-dining", date: priorDate, amount: 22.25, direction: "expense", payee: "Signal Coffee", category: "Dining", account: "Demo Card", notes: "Fictional prior-month dining" },
  ];
}

export function recordDemoImportedTransaction(seed: DemoSeed, item: TransactionImportItem) {
  const transaction = {
    id: item.id,
    date: item.date || seed.dateKey,
    amount: Math.abs(item.amountCents || 0) / 100,
    direction: (item.amountCents || 0) > 0 ? "income" : "expense",
    payee: item.payee || "Demo payee",
    category: seed.actualMetadata.categories.flatMap((group) => group.categories)
      .find((category) => category.id === item.actualCategoryId)?.name || "Uncategorized",
    account: seed.actualMetadata.accounts.find((account) => account.id === item.actualAccountId)?.name || "Demo Checking",
    notes: item.notes,
  };
  const existing = seed.transactions.findIndex((entry) => entry.id === transaction.id);
  if (existing < 0) seed.transactions.push(transaction);
  else seed.transactions[existing] = transaction;
}

export function buildDemoCalendarBillsRange(seed: DemoSeed, url: URL) {
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  return {
    schedules: demoDateRange(seed.bills, start, end, (item) => item.next_date),
    transactions: demoDateRange(seed.transactions, start, end, (item) => item.date),
    transactionsTruncated: false,
    payeeMap: structuredClone(seed.currentDashboard.payeeMap),
    actualBudgetUrl: seed.currentDashboard.actualBudgetUrl,
    syncHealth: structuredClone(seed.currentDashboard.billsSyncHealth),
  };
}
