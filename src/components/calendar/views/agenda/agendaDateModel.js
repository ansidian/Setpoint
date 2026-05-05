import {
  addDaysYmd,
  pacificYMD,
  parseYmd,
  ymdFromParts,
} from "../../calendarDateUtils.js";

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

function localDate(parsed) {
  return new Date(parsed.year, parsed.month, parsed.day);
}

function shortDateLabel(dateKey) {
  const parsed = parseYmd(dateKey);
  if (!parsed) return "";
  const year = String(parsed.year).slice(-2);
  return `${parsed.month + 1}/${parsed.day}/${year}`;
}

export function formatAgendaHeaderLabel(dateKey, todayKey = pacificYMD(Date.now())) {
  if (dateKey === todayKey) return `TODAY ${shortDateLabel(dateKey)}`;
  if (dateKey === addDaysYmd(todayKey, 1)) return `TOMORROW ${shortDateLabel(dateKey)}`;
  const parsed = parseYmd(dateKey);
  const weekday = parsed ? WEEKDAY_FORMATTER.format(localDate(parsed)).toUpperCase() : "DAY";
  return `${weekday} ${shortDateLabel(dateKey)}`;
}

export function monthBounds(viewYear, viewMonth) {
  const start = ymdFromParts(viewYear, viewMonth, 1);
  const end = ymdFromParts(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());
  return { start, end };
}

export function clampRangeToMonth(range, viewYear, viewMonth) {
  if (!range) return null;
  const { start, end } = monthBounds(viewYear, viewMonth);
  if (range.endDate < start || range.startDate > end) return null;
  return {
    startDate: range.startDate < start ? start : range.startDate,
    endDate: range.endDate > end ? end : range.endDate,
  };
}

export function buildDisplayedMonthGroups({
  viewYear,
  viewMonth,
  todayKey = pacificYMD(Date.now()),
  createGroup = null,
} = {}) {
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
    };
  });

  return {
    groups,
    groupMap: new Map(groups.map((group) => [group.dateKey, group])),
    monthStartDateKey,
  };
}

export function sparseVisibleGroups({
  groups,
  monthStartDateKey,
  forceVisibleDateKey = null,
  hasVisibleItems = (group) => group.hasItems,
} = {}) {
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
