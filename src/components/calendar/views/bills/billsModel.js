import { daysUntil } from "../../../../lib/bill-utils";
import { parseYmd } from "../../calendarDateUtils.js";

export const MAX_PILLS = 2;

export const TRACKED_UTILITIES = [
  { key: "sce", label: "Electricity", match: "sce" },
  { key: "water", label: "Water", match: "sgv water" },
  { key: "spectrum", label: "Internet", match: "spectrum" },
  { key: "socalgas", label: "Gas", match: "socalgas" },
  { key: "trash", label: "Trash", match: "valley vista" },
];

export function formatShortDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function relativeDateLabel(days) {
  if (days === null || days === undefined) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "1 day ago";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export function formatFullDate(year, month, day, selectedDateKey) {
  const parsed = parseYmd(selectedDateKey);
  if (parsed) {
    const d = new Date(parsed.year, parsed.month, parsed.day);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function scheduleToBill(schedule, payeeMap) {
  if (!schedule?.conditions) {
    return {
      id: schedule.id,
      scheduleId: schedule.scheduleId || schedule.id,
      transactionId: schedule.transactionId || null,
      name: schedule.name || schedule.payee || "Unknown",
      payee: schedule.payee || schedule.name || "Unknown",
      amount: Number(schedule.amount || 0),
      next_date: schedule.next_date,
      paid: !!schedule.paid,
      type: schedule.type || "bill",
      openActionDisabled: !!schedule.openActionDisabled,
    };
  }
  const amtCond = schedule.conditions?.find((c) => c.field === "amount");
  const payeeCond = schedule.conditions?.find((c) => c.field === "payee");
  const rawAmt = amtCond?.value;
  const amountCents = typeof rawAmt === "object" && rawAmt !== null ? (rawAmt.num1 ?? 0) : (rawAmt ?? 0);
  const payeeName = payeeCond ? payeeMap[payeeCond.value] : schedule.name;
  return {
    id: schedule.id,
    scheduleId: schedule.id,
    name: schedule.name || payeeName || "Unknown",
    payee: payeeName || schedule.name || "Unknown",
    amount: Math.abs(amountCents) / 100,
    next_date: schedule.next_date,
    paid: !!schedule.paid,
    type: schedule.type || "bill",
  };
}

function orderBills(items = []) {
  return [...items].sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    const aName = (a.name || a.payee || "").toLowerCase();
    const bName = (b.name || b.payee || "").toLowerCase();
    return aName.localeCompare(bName);
  });
}

function groupBills(items = []) {
  const ordered = orderBills(items);
  const activeItems = ordered.filter((item) => !item.paid);
  const completedItems = ordered.filter((item) => item.paid);
  return {
    items: ordered,
    activeItems,
    completedItems,
    activeCount: activeItems.length,
    completedCount: completedItems.length,
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
const billDayStateCache = new WeakMap();

export function getDayState(rawItems) {
  if (rawItems?.activeItems) return rawItems;
  if (!Array.isArray(rawItems)) return groupBills([]);
  const cached = billDayStateCache.get(rawItems);
  if (cached) return cached;
  const state = groupBills(rawItems);
  billDayStateCache.set(rawItems, state);
  return state;
}

export function getDefaultSelectedItemId(items = []) {
  const state = getDayState(items);
  const fallback = state.activeItems[0] || state.completedItems[0];
  return String(fallback?.id || "");
}

export function billMatchesItemId(bill, itemId) {
  if (bill == null || itemId == null) return false;
  const target = String(itemId);
  return String(bill.id) === target || String(bill.scheduleId || "") === target;
}

export function compute({ data, viewYear, viewMonth }) {
  const schedules = data?.schedules || [];
  const payeeMap = data?.payeeMap || {};

  const itemsByDay = {};
  const itemsByDate = {};

  if (schedules.length) {
    for (const schedule of schedules) {
      if (!schedule.next_date || schedule.type === "income") continue;
      const date = new Date(`${schedule.next_date}T00:00:00`);
      const day = date.getDate();
      const bill = scheduleToBill(schedule, payeeMap);
      if (!itemsByDate[schedule.next_date]) itemsByDate[schedule.next_date] = [];
      itemsByDate[schedule.next_date].push(bill);
      if (date.getFullYear() !== viewYear || date.getMonth() !== viewMonth) continue;
      if (!itemsByDay[day]) itemsByDay[day] = [];
      itemsByDay[day].push(bill);
    }
  }

  let monthTotal = 0;
  for (const bills of Object.values(itemsByDay)) {
    for (const bill of bills) monthTotal += bill.amount;
  }

  for (const day of Object.keys(itemsByDay)) {
    itemsByDay[day] = groupBills(itemsByDay[day]);
  }
  for (const dateKey of Object.keys(itemsByDate)) {
    itemsByDate[dateKey] = groupBills(itemsByDate[dateKey]);
  }

  return { itemsByDay, itemsByDate, monthTotal };
}

export function hasOverdue(items) {
  const state = getDayState(items);
  return state.activeItems.some((bill) => daysUntil(bill.next_date) < 0);
}

export function allComplete(_items) {
  return false;
}

export function payUrlForBill(bill, payLinksByScheduleId) {
  const scheduleId = bill?.scheduleId || bill?.id;
  if (!scheduleId) return null;
  const url = payLinksByScheduleId?.[scheduleId];
  return typeof url === "string" && url ? url : null;
}

export function getScheduleUrl(bill, actualBudgetUrl) {
  const scheduleId = bill?.scheduleId || bill?.id;
  return actualBudgetUrl
    ? `${actualBudgetUrl.replace(/\/+$/, "")}/schedules?highlight=${scheduleId}`
    : null;
}
