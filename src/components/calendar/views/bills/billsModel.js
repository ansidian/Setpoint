import { daysUntil } from "../../../../lib/bill-utils";

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

export function formatFullDate(year, month, day) {
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function scheduleToBill(schedule, payeeMap) {
  const amtCond = schedule.conditions?.find((c) => c.field === "amount");
  const payeeCond = schedule.conditions?.find((c) => c.field === "payee");
  const rawAmt = amtCond?.value;
  const amountCents = typeof rawAmt === "object" && rawAmt !== null ? (rawAmt.num1 ?? 0) : (rawAmt ?? 0);
  const payeeName = payeeCond ? payeeMap[payeeCond.value] : schedule.name;
  return {
    id: schedule.id,
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

export function getDayState(rawItems) {
  if (rawItems?.activeItems) return rawItems;
  return groupBills(Array.isArray(rawItems) ? rawItems : []);
}

export function getDefaultSelectedItemId(items = []) {
  const state = getDayState(items);
  const fallback = state.activeItems[0] || state.completedItems[0];
  return String(fallback?.id || "");
}

export function compute({ data, viewYear, viewMonth }) {
  const schedules = data?.schedules || [];
  const recentTransactions = data?.recentTransactions || [];
  const payeeMap = data?.payeeMap || {};

  const itemsByDay = {};
  const seen = new Set();

  if (schedules.length) {
    for (const schedule of schedules) {
      if (!schedule.next_date || schedule.type === "income") continue;
      const date = new Date(`${schedule.next_date}T00:00:00`);
      if (date.getFullYear() !== viewYear || date.getMonth() !== viewMonth) continue;
      const day = date.getDate();
      if (!itemsByDay[day]) itemsByDay[day] = [];
      itemsByDay[day].push(scheduleToBill(schedule, payeeMap));
      seen.add(`${schedule.id}:${day}`);
    }
  }

  if (recentTransactions.length && schedules.length) {
    const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    for (const transaction of recentTransactions) {
      if (!transaction.scheduleId || !transaction.date) continue;
      const schedule = scheduleById.get(transaction.scheduleId);
      if (!schedule || schedule.type === "income") continue;
      const date = new Date(`${transaction.date}T00:00:00`);
      if (date.getFullYear() !== viewYear || date.getMonth() !== viewMonth) continue;
      const day = date.getDate();
      const key = `${transaction.scheduleId}:${day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!itemsByDay[day]) itemsByDay[day] = [];
      itemsByDay[day].push({
        ...scheduleToBill(schedule, payeeMap),
        next_date: transaction.date,
        amount: transaction.amount,
        paid: true,
      });
    }
  }

  let monthTotal = 0;
  for (const bills of Object.values(itemsByDay)) {
    for (const bill of bills) monthTotal += bill.amount;
  }

  for (const day of Object.keys(itemsByDay)) {
    itemsByDay[day] = groupBills(itemsByDay[day]);
  }

  return { itemsByDay, monthTotal };
}

export function hasOverdue(items) {
  const state = getDayState(items);
  return state.activeItems.some((bill) => daysUntil(bill.next_date) < 0);
}

export function allComplete(_items) {
  return false;
}
