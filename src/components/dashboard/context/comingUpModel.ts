import { daysUntil } from "../../../lib/dashboard-helpers";
import { formatChipDateTime } from "../../../lib/shell-helpers";
type DashboardComingUpDeadline = {
  id: string;
  title?: string;
  due_date?: string | null;
  due_time?: string | null;
  status?: string;
  project_name?: string;
  class_name?: string;
};
type DashboardComingUpDeadlines = DashboardComingUpDeadline[] | { upcoming?: DashboardComingUpDeadline[] };

export type ComingUpRow = {
  id: string;
  kind: "deadline";
  title: string;
  meta: string;
  date?: string | null;
  time?: string | null;
  occurrenceKey?: string;
  sortDays?: number;
  chipTooltip?: string | null;
  chipLabel: string;
  chipTone: "rose" | "cream" | "muted";
};

function chipFor(days: number): Pick<ComingUpRow, "chipLabel" | "chipTone"> {
  if (days === 0) return { chipLabel: "Today", chipTone: "rose" };
  if (days === 1) return { chipLabel: "Tomorrow", chipTone: "cream" };
  return { chipLabel: `In ${days}d`, chipTone: "muted" };
}

function asDeadlineList(liveDeadlines: DashboardComingUpDeadlines | null | undefined): DashboardComingUpDeadline[] {
  if (Array.isArray(liveDeadlines)) return liveDeadlines;
  return liveDeadlines?.upcoming || [];
}

// Upcoming deadlines as one next-`days`-day list, sorted
// soonest-first, each carrying a time-anchored StatusChip label/tone. Pure: all
// "today" math flows through daysUntil (Pacific-day anchored).
export function buildComingUp({
  liveDeadlines,
  days = 7,
  includeToday = true,
}: {
  liveDeadlines?: DashboardComingUpDeadlines | null;
  days?: number;
  includeToday?: boolean;
} = {}): ComingUpRow[] {
  const rows: ComingUpRow[] = [];

  for (const d of asDeadlineList(liveDeadlines)) {
    if (d?.status === "complete") continue;
    const n = daysUntil(d?.due_date);
    if (n == null || n < (includeToday ? 0 : 1) || n > days) continue;
    rows.push({
      id: `deadline:${d.id}`, kind: "deadline", title: d.title || "",
      date: d.due_date, time: d.due_time, occurrenceKey: `deadline:${d.id}:${d.due_date}`,
      meta: d.class_name || d.project_name || "Deadline", sortDays: n,
      chipTooltip: formatChipDateTime(d.due_date, d.due_time, n === 0, "long"), ...chipFor(n),
    });
  }

  rows.sort((a, b) => {
    if (a.sortDays !== b.sortDays) return a.sortDays! - b.sortDays!;
    return a.title.localeCompare(b.title);
  });

  return rows;
}
