import { daysUntil } from "../../../../lib/bill-utils";
import { parseYmd } from "../../calendarDateUtils.ts";
import type { CalendarItemLike } from "../calendarViewTypes";

interface BillCondition {
  field: string;
  value: unknown;
}

export interface BillScheduleInput extends Record<string, unknown> {
  id?: string;
  scheduleId?: string | null;
  transactionId?: string | null;
  name?: string | null;
  payee?: string | null;
  amount?: number | string | null;
  next_date?: string | null;
  paid?: boolean;
  type?: string;
  openActionDisabled?: boolean;
  conditions?: BillCondition[] | null;
}

export interface FinanceItem extends CalendarItemLike {
  id?: string;
  scheduleId?: string | null;
  transactionId?: string | null;
  name?: string;
  payee?: string;
  amount?: number;
  next_date?: string | null;
  date?: string;
  paid?: boolean;
  type?: string;
  direction?: string;
  category?: string;
  account?: string;
  notes?: string;
  openActionDisabled?: boolean;
}

export interface FinanceDayState {
  items: FinanceItem[];
  billItems: FinanceItem[];
  transactionItems: FinanceItem[];
  activeItems: FinanceItem[];
  completedItems: FinanceItem[];
  incomeItems: FinanceItem[];
  expenseItems: FinanceItem[];
  activeCount: number;
  completedCount: number;
  transactionCount: number;
  totalCount: number;
}

export interface BillsViewData {
  schedules?: BillScheduleInput[];
  transactions?: Array<FinanceItem | (Record<string, unknown> & { id: string; date: string; amount: number | string | null; payee?: string; direction?: string })>;
  payeeMap?: Record<string, string>;
  allSchedules?: BillScheduleInput[];
  recentTransactions?: unknown[];
  actualBudgetUrl?: string | null;
}

export interface BillsComputed {
  itemsByDay: Record<string, FinanceDayState>;
  itemsByDate: Record<string, FinanceDayState>;
  monthTotal: number;
}

export const TRACKED_UTILITIES = [
  { key: "sce", label: "Electricity", match: "sce" },
  { key: "water", label: "Water", match: "sgv water" },
  { key: "spectrum", label: "Internet", match: "spectrum" },
  { key: "socalgas", label: "Gas", match: "socalgas" },
  { key: "trash", label: "Trash", match: "valley vista" },
];

export function formatShortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function relativeDateLabel(days?: number | null): string {
  if (days === null || days === undefined) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "1 day ago";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export function formatFullDate(year: number, month: number, day: number, selectedDateKey?: string | null): string {
  const parsed = parseYmd(selectedDateKey);
  if (parsed) {
    const d = new Date(parsed.year, parsed.month, parsed.day);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function scheduleToBill(schedule: BillScheduleInput, payeeMap: Record<string, string>): FinanceItem {
  if (!schedule?.conditions) {
    const rawAmount = schedule.amount;
    return {
      id: String(schedule.id || schedule.scheduleId || ""),
      scheduleId: schedule.scheduleId || schedule.id,
      transactionId: schedule.transactionId || null,
      name: schedule.name || schedule.payee || "Unknown",
      payee: schedule.payee || schedule.name || "Unknown",
      amount: rawAmount == null || rawAmount === "" ? Number.NaN : Number(rawAmount),
      next_date: schedule.next_date,
      paid: !!schedule.paid,
      type: schedule.type || "bill",
      openActionDisabled: !!schedule.openActionDisabled,
    };
  }
  const amtCond = schedule.conditions?.find((c) => c.field === "amount");
  const payeeCond = schedule.conditions?.find((c) => c.field === "payee");
  const rawAmt = amtCond?.value;
  const rawAmountCents = typeof rawAmt === "object" && rawAmt !== null && "num1" in rawAmt
    ? rawAmt.num1
    : rawAmt;
  const amountCents = rawAmountCents == null || rawAmountCents === ""
    ? Number.NaN
    : Number(rawAmountCents);
  const payeeName = payeeCond ? payeeMap[String(payeeCond.value)] : schedule.name;
  return {
    id: String(schedule.id || ""),
    scheduleId: String(schedule.id || ""),
    name: schedule.name || payeeName || "Unknown",
    payee: payeeName || schedule.name || "Unknown",
    amount: Math.abs(amountCents) / 100,
    next_date: schedule.next_date,
    paid: !!schedule.paid,
    type: schedule.type || "bill",
  };
}

export function isTransaction(item: FinanceItem | null | undefined): boolean {
  return item?.type === "transaction";
}

export function orderFinanceItems(items: FinanceItem[] = []): FinanceItem[] {
  const bills = items.filter((item) => !isTransaction(item)).sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    const aName = (a.name || a.payee || "").toLowerCase();
    const bName = (b.name || b.payee || "").toLowerCase();
    return aName.localeCompare(bName);
  });
  const byAmountThenName = (a: FinanceItem, b: FinanceItem) => (
    (Number(b.amount) || 0) - (Number(a.amount) || 0)
    || String(a.name || a.payee || "").localeCompare(String(b.name || b.payee || ""))
  );
  const income = items.filter((item) => isTransaction(item) && item.direction === "income").sort(byAmountThenName);
  const expenses = items.filter((item) => isTransaction(item) && item.direction !== "income").sort(byAmountThenName);
  return [...bills, ...income, ...expenses];
}

export function groupFinanceItems(items: FinanceItem[] = []): FinanceDayState {
  const ordered = orderFinanceItems(items);
  const billItems = ordered.filter((item) => !isTransaction(item));
  const transactionItems = ordered.filter(isTransaction);
  const activeItems = billItems.filter((item) => !item.paid);
  const completedItems = billItems.filter((item) => item.paid);
  const incomeItems = transactionItems.filter((item) => item.direction === "income");
  const expenseItems = transactionItems.filter((item) => item.direction !== "income");
  return {
    items: ordered,
    billItems,
    transactionItems,
    activeItems,
    completedItems,
    incomeItems,
    expenseItems,
    activeCount: activeItems.length,
    completedCount: completedItems.length,
    transactionCount: transactionItems.length,
    totalCount: ordered.length,
  };
}

// billsView.compute() already pre-groups every itemsByDay/itemsByDate value
// via groupBills() before storing it (see compute() below), so by the time
// the grid's real render path calls getDayState on that value, it already
// has an `activeItems` property and getDayState's own short-circuit
// (`if (rawItems?.activeItems) return rawItems;`) hands back that same
// stable reference — no fresh object, no defeated memo. This WeakMap cache
// is never reached by that path. It exists as a defensive fallback for any
// caller that invokes getDayState (or the raw-array-accepting
// getDefaultSelectedItemId / hasOverdue below) with a genuine ungrouped
// array directly — no such caller exists in the current codebase, but the
// shared view-object contract (mirrored by eventsView/deadlinesModel)
// documents these functions as accepting raw items, so a caller could pass
// one in the future. If that happens, this cache keeps repeated calls with
// the same array reference from reallocating a fresh grouped object each
// time.
const billDayStateCache = new WeakMap<FinanceItem[], FinanceDayState>();

export function getDayState(rawItems: unknown): FinanceDayState {
  if (rawItems && typeof rawItems === "object" && "activeItems" in rawItems) return rawItems as FinanceDayState;
  if (!Array.isArray(rawItems)) return groupFinanceItems([]);
  const items = rawItems as FinanceItem[];
  const cached = billDayStateCache.get(items);
  if (cached) return cached;
  const state = groupFinanceItems(items);
  billDayStateCache.set(items, state);
  return state;
}

export function getDefaultSelectedItemId(items: unknown = []): string {
  const state = getDayState(items);
  const fallback = state.items[0];
  return String(fallback?.id || "");
}

export function billMatchesItemId(bill: unknown, itemId: unknown): boolean {
  if (bill == null || itemId == null) return false;
  const financeItem = bill as FinanceItem;
  const target = String(itemId);
  return String(financeItem.id) === target || String(financeItem.scheduleId || "") === target;
}

export function compute({ data, viewYear, viewMonth }: { data?: BillsViewData | null; viewYear: number; viewMonth: number }): BillsComputed {
  const schedules = data?.schedules || [];
  const transactions = data?.transactions || [];
  const payeeMap = data?.payeeMap || {};

  const rawItemsByDay: Record<string, FinanceItem[]> = {};
  const rawItemsByDate: Record<string, FinanceItem[]> = {};

  if (schedules.length) {
    for (const schedule of schedules) {
      if (!schedule.next_date || schedule.type === "income") continue;
      const date = new Date(`${schedule.next_date}T00:00:00`);
      const day = date.getDate();
      const bill = scheduleToBill(schedule, payeeMap);
      if (!Number.isFinite(bill.amount)) continue;
      if (!rawItemsByDate[schedule.next_date]) rawItemsByDate[schedule.next_date] = [];
      rawItemsByDate[schedule.next_date]!.push(bill);
      if (date.getFullYear() !== viewYear || date.getMonth() !== viewMonth) continue;
      if (!rawItemsByDay[day]) rawItemsByDay[day] = [];
      rawItemsByDay[day]!.push(bill);
    }
  }

  for (const transaction of transactions) {
    if (!transaction?.date) continue;
    const date = new Date(`${transaction.date}T00:00:00`);
    if (transaction.amount == null || transaction.amount === "") continue;
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount)) continue;
    const item = {
      ...transaction,
      amount,
      type: "transaction",
      name: transaction.payee || "Unknown",
    };
    if (!rawItemsByDate[transaction.date]) rawItemsByDate[transaction.date] = [];
    rawItemsByDate[transaction.date]!.push(item as FinanceItem);
    if (date.getFullYear() !== viewYear || date.getMonth() !== viewMonth) continue;
    const day = date.getDate();
    if (!rawItemsByDay[day]) rawItemsByDay[day] = [];
    rawItemsByDay[day]!.push(item as FinanceItem);
  }

  let monthTotal = 0;
  for (const items of Object.values(rawItemsByDay)) {
    for (const item of items) {
      if (!isTransaction(item)) monthTotal += item.amount || 0;
    }
  }

  const itemsByDay: Record<string, FinanceDayState> = {};
  const itemsByDate: Record<string, FinanceDayState> = {};
  for (const day of Object.keys(rawItemsByDay)) {
    itemsByDay[day] = groupFinanceItems(rawItemsByDay[day]);
  }
  for (const dateKey of Object.keys(rawItemsByDate)) {
    itemsByDate[dateKey] = groupFinanceItems(rawItemsByDate[dateKey]);
  }

  return { itemsByDay, itemsByDate, monthTotal };
}

export function hasOverdue(items: unknown): boolean {
  const state = getDayState(items);
  return state.activeItems.some((bill) => {
    const days = daysUntil(bill.next_date);
    return days != null && days < 0;
  });
}

export function allComplete(_items: unknown): boolean {
  return false;
}

export function payUrlForBill(bill: FinanceItem | null | undefined, payLinksByScheduleId?: Record<string, string> | null): string | null {
  const scheduleId = bill?.scheduleId || bill?.id;
  if (!scheduleId) return null;
  const url = payLinksByScheduleId?.[scheduleId];
  return typeof url === "string" && url ? url : null;
}

export function getScheduleUrl(bill: FinanceItem | null | undefined, actualBudgetUrl?: string | null): string | null {
  const scheduleId = bill?.scheduleId || bill?.id;
  return actualBudgetUrl
    ? `${actualBudgetUrl.replace(/\/+$/, "")}/schedules?highlight=${scheduleId}`
    : null;
}
