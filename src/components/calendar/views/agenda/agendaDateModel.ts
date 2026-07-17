import {
  addDaysYmd,
  pacificYMD,
  parseYmd,
  ymdFromParts,
} from "../../calendarDateUtils.ts";

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

export interface AgendaDateGroup {
  dateKey: string;
  day: number;
  headerLabel: string;
  hasItems: boolean;
  forceVisible: boolean;
  isFallback: boolean;
}

function localDate(parsed: { year: number; month: number; day: number }): Date {
  return new Date(parsed.year, parsed.month, parsed.day);
}

function shortDateLabel(dateKey: string): string {
  const parsed = parseYmd(dateKey);
  if (!parsed) return "";
  const year = String(parsed.year).slice(-2);
  return `${parsed.month + 1}/${parsed.day}/${year}`;
}

export function formatAgendaHeaderLabel(dateKey: string, todayKey = pacificYMD(Date.now())): string {
  if (dateKey === addDaysYmd(todayKey, -1)) return `YESTERDAY ${shortDateLabel(dateKey)}`;
  if (dateKey === todayKey) return `TODAY ${shortDateLabel(dateKey)}`;
  if (dateKey === addDaysYmd(todayKey, 1)) return `TOMORROW ${shortDateLabel(dateKey)}`;
  const parsed = parseYmd(dateKey);
  const weekday = parsed ? WEEKDAY_FORMATTER.format(localDate(parsed)).toUpperCase() : "DAY";
  return `${weekday} ${shortDateLabel(dateKey)}`;
}

export function monthBounds(viewYear: number, viewMonth: number): { start: string; end: string } {
  const start = ymdFromParts(viewYear, viewMonth, 1);
  const end = ymdFromParts(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());
  return { start, end };
}

export function clampRangeToMonth(
  range: { startDate: string; endDate: string } | null | undefined,
  viewYear: number,
  viewMonth: number,
): { startDate: string; endDate: string } | null {
  if (!range) return null;
  const { start, end } = monthBounds(viewYear, viewMonth);
  if (range.endDate < start || range.startDate > end) return null;
  return {
    startDate: range.startDate < start ? start : range.startDate,
    endDate: range.endDate > end ? end : range.endDate,
  };
}

export function buildDisplayedMonthGroups<TGroup extends AgendaDateGroup = AgendaDateGroup>({
  viewYear,
  viewMonth,
  todayKey = pacificYMD(Date.now()),
  createGroup = null,
}: {
  viewYear: number;
  viewMonth: number;
  todayKey?: string;
  createGroup?: ((input: { dateKey: string; day: number }) => Omit<TGroup, keyof AgendaDateGroup> | Partial<TGroup>) | null;
}) {
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthStartDateKey = ymdFromParts(viewYear, viewMonth, 1);
  const groups = Array.from({ length: daysInMonth }, (_, index) => {
    const dateKey = ymdFromParts(viewYear, viewMonth, index + 1);
    return {
      dateKey,
      day: index + 1,
      headerLabel: formatAgendaHeaderLabel(dateKey, todayKey),
      hasItems: false,
      forceVisible: dateKey === todayKey,
      isFallback: false,
      ...(createGroup?.({ dateKey, day: index + 1 }) || {}),
    } as TGroup;
  });

  return {
    groups,
    groupMap: new Map(groups.map((group) => [group.dateKey, group])),
    monthStartDateKey,
  };
}

export function sparseVisibleGroups<TGroup extends AgendaDateGroup>({
  groups,
  monthStartDateKey,
  forceVisibleDateKey = null,
  hasVisibleItems = (group: TGroup) => group.hasItems,
}: {
  groups: TGroup[];
  monthStartDateKey: string;
  forceVisibleDateKey?: string | null;
  hasVisibleItems?: (group: TGroup) => boolean;
}) {
  let visibleGroups = groups.filter((group) => (
    (forceVisibleDateKey && group.dateKey === forceVisibleDateKey)
    || group.forceVisible
    || hasVisibleItems(group)
  ));

  const monthStart = groups[0];
  if (monthStart && !visibleGroups.some((group) => group.dateKey === monthStart.dateKey)) {
    if (!visibleGroups.length) monthStart.isFallback = true;
    visibleGroups = [monthStart, ...visibleGroups];
  }

  if (!visibleGroups.length && monthStart) {
    monthStart.isFallback = true;
    visibleGroups = [monthStart];
  }

  return {
    visibleGroups,
    firstVisibleDateKey: visibleGroups[0]?.dateKey || monthStartDateKey,
  };
}
