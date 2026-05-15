import { formatAmount, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { addDaysYmd, ymdFromParts } from "../../calendarDateUtils.js";
import { buildDisplayedMonthGroups, sparseVisibleGroups } from "../agenda/agendaDateModel.js";
import { getDayState } from "./billsModel.js";

function billDueLabel(bill) {
  if (bill.paid) return "Paid";
  const days = daysUntil(bill.next_date);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days == null) return "Scheduled";
  return `In ${days} days`;
}

function billStatusLabel(bill) {
  if (bill.paid) return "Paid";
  if (bill.type === "transfer") return "Transfer";
  return "Scheduled";
}

function billDotColor(bill) {
  if (bill.paid) return "#a6e3a1";
  if (bill.type === "transfer") return "#89b4fa";
  return urgencyColor(daysUntil(bill.next_date)).accent;
}

function toAgendaBill(bill, dateKey) {
  const dotColor = billDotColor(bill);
  return {
    ...bill,
    agendaDateKey: dateKey,
    agendaItemId: String(bill.scheduleId || bill.id),
    agendaKey: `${bill.id}-${dateKey}`,
    agendaTitle: bill.name || bill.payee || "Untitled bill",
    agendaSubtitle: bill.payee && bill.payee !== bill.name ? bill.payee : "",
    agendaMeta: billDueLabel(bill),
    agendaStatus: billStatusLabel(bill),
    agendaAmount: formatAmount(bill.amount),
    agendaDotColor: dotColor,
    agendaSelectedColor: dotColor,
    agendaComplete: !!bill.paid,
  };
}

function miniCalendarBounds(viewYear, viewMonth) {
  const monthStart = ymdFromParts(viewYear, viewMonth, 1);
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const startDate = addDaysYmd(monthStart, -firstDay);
  return {
    startDate,
    endDate: addDaysYmd(startDate, 41),
  };
}

export function buildBillsAgendaGroups({
  computed,
  viewYear,
  viewMonth,
  todayKey,
  forceVisibleDateKey = null,
} = {}) {
  const { groups, groupMap, monthStartDateKey } = buildDisplayedMonthGroups({
    viewYear,
    viewMonth,
    todayKey,
    createGroup: () => ({
      items: [],
      hasBills: false,
    }),
  });

  for (const [dateKey, rawItems] of Object.entries(computed?.itemsByDate || {})) {
    const group = groupMap.get(dateKey);
    if (!group) continue;
    const state = getDayState(rawItems);
    group.items = state.items.map((bill) => toAgendaBill(bill, dateKey));
    group.hasBills = group.items.length > 0;
    group.hasItems = group.hasBills;
  }

  const { visibleGroups, firstVisibleDateKey } = sparseVisibleGroups({
    groups,
    monthStartDateKey,
    forceVisibleDateKey,
    hasVisibleItems: (group) => group.hasBills,
  });

  return {
    groups,
    visibleGroups,
    firstVisibleDateKey,
    monthStartDateKey,
  };
}

export function buildBillsMiniCalendarActivityItems({
  computed,
  viewYear,
  viewMonth,
} = {}) {
  const bounds = miniCalendarBounds(viewYear, viewMonth);
  return Object.entries(computed?.itemsByDate || {})
    .filter(([dateKey]) => dateKey >= bounds.startDate && dateKey <= bounds.endDate)
    .flatMap(([dateKey, rawItems]) => (
      getDayState(rawItems).items.map((item) => ({
        ...toAgendaBill(item, dateKey),
        kind: "bill",
        dateKey,
      }))
    ));
}
