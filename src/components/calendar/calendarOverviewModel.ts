import { getCalendarViewMeta } from "./calendarEmptyStateMeta.ts";

export type ItemsByDay = Record<number | string, unknown>;
interface OverviewComputed { totalEvents?: number; allDayEvents?: number }
export interface OverviewOptions { view: string; viewYear: number; viewMonth: number; itemsByDay?: ItemsByDay; computed?: unknown; data?: unknown; [key: string]: unknown }
export interface EmptyDayActionOptions {
  view: string;
  viewYear: number;
  viewMonth: number;
  selectedDay?: number | null;
  selectedDateKey?: string | null;
  eventEditor?: { editable?: boolean } | null;
  onCreateEvent?: (() => void) | null;
}
export interface NeighborActiveView { getDayState?: (items: never) => { activeCount?: number; totalCount?: number } }

function formatMonthLabel(viewYear: number, viewMonth: number): string {
  return new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function formatFullDate(viewYear: number, viewMonth: number, day: number): string {
  return new Date(viewYear, viewMonth, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function countActiveDays(itemsByDay?: ItemsByDay): number {
  return Object.keys(itemsByDay || {}).length;
}

export function getOverviewModel({
  viewYear,
  viewMonth,
  itemsByDay,
  computed,
}: OverviewOptions) {
  const overviewComputed = computed && typeof computed === "object" ? computed as OverviewComputed : null;
  const meta = getCalendarViewMeta();
  const monthLabel = formatMonthLabel(viewYear, viewMonth);
  const activeDays = countActiveDays(itemsByDay);
  const totalEvents = overviewComputed?.totalEvents || 0;
  const allDayEvents = overviewComputed?.allDayEvents || 0;

  return {
    ...meta,
    eyebrow: "Month overview",
    title: monthLabel,
    description: totalEvents
      ? `${activeDays} active day${activeDays === 1 ? "" : "s"} spread across the month. Select a day to inspect timing, attendees, and links.`
      : `No events are scheduled in ${monthLabel} yet. Select a day to inspect a clean block or add something new.`,
    spotlight: {
      label: "Events this month",
      value: `${totalEvents}`,
      detail: allDayEvents
        ? `${allDayEvents} all-day item${allDayEvents === 1 ? "" : "s"}`
        : "No all-day holds",
    },
    stats: [
      {
        label: "Active days",
        value: `${activeDays}`,
        detail: totalEvents ? "Days carrying calendar load" : "Month is still open",
      },
      {
        label: "All-day",
        value: `${allDayEvents}`,
        detail: allDayEvents ? "Long blocks on the calendar" : "Nothing spans the whole day",
      },
    ],
    footerLabel: "Month detail",
  };
}

function parseDateKey(dateKey: unknown): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

function formatShortDate(viewYear: number, viewMonth: number, selectedDay?: number | null, selectedDateKey?: string | null): string | null {
  const parsed = parseDateKey(selectedDateKey);
  if (!selectedDay && !parsed) return null;
  return new Date(parsed?.year ?? viewYear, parsed?.month ?? viewMonth, parsed?.day ?? selectedDay ?? 1).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function emptyDayPrimaryAction(props: EmptyDayActionOptions) {
  const dateLabel = formatShortDate(props.viewYear, props.viewMonth, props.selectedDay, props.selectedDateKey);
  if (props.view === "events" && props.eventEditor?.editable && props.onCreateEvent) {
    return {
      label: dateLabel ? `Create on ${dateLabel}` : "Create event",
      detail: "Create directly on the selected date.",
      onClick: props.onCreateEvent,
    };
  }

  return null;
}

export function formatNeighborDate(year: number, month: number, day: number): string {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function neighborActiveCount(activeView: NeighborActiveView | null | undefined, items: unknown) {
  if (activeView?.getDayState) {
    const state = activeView.getDayState(items as never);
    return {
      active: state.activeCount || 0,
      total: state.totalCount || 0,
    };
  }
  const list = Array.isArray(items) ? items : [];
  return { active: list.length, total: list.length };
}

export function findNeighborDays(itemsByDay: ItemsByDay | null | undefined, selectedDay: number): { prev: number | null; next: number | null } {
  const days = Object.keys(itemsByDay || {})
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  let prev = null;
  let next = null;
  for (const day of days) {
    if (day < selectedDay) prev = day;
    else if (day > selectedDay && next === null) next = day;
  }
  return { prev, next };
}
