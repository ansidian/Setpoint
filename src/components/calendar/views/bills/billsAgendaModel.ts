import { formatAmount, daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { addDaysYmd, pacificYMD, ymdFromParts } from "../../calendarDateUtils.ts";
import { buildDisplayedMonthGroups, sparseVisibleGroups } from "../agenda/agendaDateModel.ts";
import { compute, getDayState } from "./billsModel.ts";
import { FINANCE_SOURCE_COLORS, transactionDirectionColor } from "./financeSourceColors.ts";
import type { AgendaDateGroup } from "../agenda/agendaDateModel";
import type { BillsComputed, BillsViewData, FinanceItem } from "./billsModel";

export interface AgendaFinanceItem extends FinanceItem {
  agendaDateKey: string;
  agendaItemId: string;
  agendaItemKind?: string;
  agendaKey: string;
  agendaTitle: string;
  agendaSubtitle: string;
  agendaMeta: string;
  agendaStatus: string;
  agendaAmount: string;
  agendaDotColor: string;
  agendaSelectedColor: string;
  agendaComplete: boolean;
  kind?: string;
  dateKey?: string | null;
}

export interface BillsAgendaGroup extends AgendaDateGroup {
  items: AgendaFinanceItem[];
  hasBills: boolean;
}

export interface BillsAgendaResult {
  groups: BillsAgendaGroup[];
  visibleGroups: BillsAgendaGroup[];
  firstVisibleDateKey: string;
  monthStartDateKey: string;
}

export type BillsAgendaMonthResult = BillsAgendaResult & { monthKey: string; year: number; month: number };

export interface BillsAgendaCacheEntry {
  inputs: { bucket: BillsViewData | null; todayKey: string; forceKey: string | null };
  value: BillsAgendaMonthResult;
}

function billDueLabel(bill: FinanceItem): string {
  if (bill.paid) return "Paid";
  const days = daysUntil(bill.next_date);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days == null) return "Scheduled";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `In ${days} days`;
}

function billStatusLabel(bill: FinanceItem): string {
  if (bill.paid) return "Paid";
  if (bill.type === "transfer") return "Transfer";
  return "Scheduled";
}

function billDotColor(bill: FinanceItem): string {
  if (bill.paid) return "#a6e3a1";
  if (bill.type === "transfer") return FINANCE_SOURCE_COLORS.transfer;
  return urgencyColor(daysUntil(bill.next_date)).accent;
}

export function toAgendaBill(bill: FinanceItem, dateKey: string): AgendaFinanceItem {
  if (bill.type === "transaction") {
    const income = bill.direction === "income";
    const dotColor = transactionDirectionColor(bill.direction);
    return {
      ...bill,
      agendaDateKey: dateKey,
      agendaItemId: String(bill.id),
      agendaItemKind: "transaction",
      agendaKey: `transaction-${bill.id}-${dateKey}`,
      agendaTitle: bill.payee || bill.name || "Unknown",
      agendaSubtitle: bill.category || "Uncategorized",
      agendaMeta: income ? "Inflow" : "Outflow",
      agendaStatus: bill.account || "Transaction",
      agendaAmount: `${income ? "+" : "−"}${formatAmount(bill.amount || 0)}`,
      agendaDotColor: dotColor,
      agendaSelectedColor: dotColor,
      agendaComplete: false,
    } as AgendaFinanceItem;
  }
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
    agendaAmount: formatAmount(bill.amount || 0),
    agendaDotColor: dotColor,
    agendaSelectedColor: dotColor,
    agendaComplete: !!bill.paid,
  } as AgendaFinanceItem;
}

function miniCalendarBounds(viewYear: number, viewMonth: number): { startDate: string; endDate: string } {
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
}: {
  computed?: BillsComputed | null;
  viewYear: number;
  viewMonth: number;
  todayKey: string;
  forceVisibleDateKey?: string | null;
} = {} as { viewYear: number; viewMonth: number; todayKey: string }): BillsAgendaResult {
  const { groups, groupMap, monthStartDateKey } = buildDisplayedMonthGroups<BillsAgendaGroup>({
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

// Per-month variant of buildBillsAgendaGroups for the infinite-scroll rail: each
// month's groups are built from that month's bills bucket (getMonthBills, a
// {schedules, payeeMap} object from the domain-range cache) and the previous
// value is reused by identity when the month's inputs are unchanged, so a
// prefetch landing mid-scroll rebuilds only the months it actually touched.
// Mirrors reuseMultiMonthAgendaGroups in eventsAgendaModel.ts — but the per-month
// bucket is ref-stable in the cache, so `===` on it is the identity key (no
// sameEventList), and the bucket is run through billsModel.compute first because
// buildBillsAgendaGroups consumes computed.itemsByDate, not raw schedules.
// Returns { list, cache }; callers thread `cache` back in as `previous`.
export function reuseMultiMonthBillsAgendaGroups({
  previous = null,
  months = [],
  getMonthBills,
  todayKey = pacificYMD(Date.now()),
  forceVisibleDateKey = null,
}: {
  previous?: Map<string, BillsAgendaCacheEntry> | null;
  months?: Array<{ year: number; month: number }>;
  getMonthBills?: ((year: number, month: number) => BillsViewData | null) | null;
  todayKey?: string;
  forceVisibleDateKey?: string | null;
} = {}) {
  const cache = new Map<string, BillsAgendaCacheEntry>();
  const list = months.map(({ year, month }) => {
    const mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    const bucket = getMonthBills ? getMonthBills(year, month) : null;
    const forceKey = forceVisibleDateKey?.startsWith(mk) ? forceVisibleDateKey : null;
    const prior = previous?.get(mk);
    if (
      prior
      && prior.inputs.bucket === bucket
      && prior.inputs.todayKey === todayKey
      && prior.inputs.forceKey === forceKey
    ) {
      cache.set(mk, prior);
      return prior.value;
    }
    const computed = compute({ data: bucket, viewYear: year, viewMonth: month });
    const value = {
      monthKey: mk,
      year,
      month,
      ...buildBillsAgendaGroups({
        computed,
        viewYear: year,
        viewMonth: month,
        todayKey,
        forceVisibleDateKey: forceKey,
      }),
    };
    cache.set(mk, { inputs: { bucket, todayKey, forceKey }, value });
    return value;
  });
  return { list, cache };
}

export function buildBillsMiniCalendarActivityItems({
  computed,
  viewYear,
  viewMonth,
}: {
  computed?: BillsComputed | null;
  viewYear: number;
  viewMonth: number;
} = {} as { viewYear: number; viewMonth: number }): AgendaFinanceItem[] {
  const bounds = miniCalendarBounds(viewYear, viewMonth);
  return Object.entries(computed?.itemsByDate || {})
    .filter(([dateKey]) => dateKey >= bounds.startDate && dateKey <= bounds.endDate)
    .flatMap(([dateKey, rawItems]) => (
      getDayState(rawItems).items.map((item) => ({
        ...toAgendaBill(item, dateKey),
        kind: item.type === "transaction" ? "transaction" : "bill",
        dateKey,
      }))
    ));
}
