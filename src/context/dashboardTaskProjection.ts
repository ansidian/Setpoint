import { addDaysYmd } from "../components/calendar/calendarDateUtils.ts";
import type { DeadlineStats, TodoistTask } from "../../shared/types/tasks";

export type DashboardDeadline = Pick<TodoistTask, "id"> & Partial<Pick<
  TodoistTask,
  | "title"
  | "due_date"
  | "due_time"
  | "class_name"
  | "class_color"
  | "points_possible"
  | "source"
  | "sourceLabel"
  | "color"
  | "sourceColor"
  | "description"
  | "url"
  | "labels"
  | "is_recurring"
  | "completed_at"
  | "_tombstone"
  | "_completing"
>> & Record<string, unknown> & {
  status?: string;
  priority?: number | null;
  content?: string;
};

export interface DashboardDeadlineRoot {
  upcoming: DashboardDeadline[];
  stats: DeadlineStats | null;
  [key: string]: unknown;
}

interface ProjectionOptions {
  now?: Date;
}

const EMPTY_DEADLINE_STATS = {
  incomplete: 0,
  dueToday: 0,
  dueThisWeek: 0,
  totalPoints: 0,
};

export const EMPTY_DEADLINES = {
  upcoming: [],
  stats: null,
} satisfies DashboardDeadlineRoot;

function clone<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function localDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date);
}

function dateWindow(now = new Date()): { today: string; weekFromNow: string } {
  const today = localDate(now);
  return {
    today,
    // Calendar-day math, not now+168h: a fixed ms shift is DST-fragile (e.g.
    // across spring-forward, +7*86400000ms from the night before can land 8
    // Pacific calendar days out instead of 7).
    weekFromNow: addDaysYmd(today, 7),
  };
}

export function deadlineMatches(
  deadline: DashboardDeadline | null | undefined,
  deadlineId: unknown,
): boolean {
  if (deadline?._tombstone || String(deadline?.id) !== String(deadlineId)) return false;
  return true;
}

function ensureDeadlineRoot(root: DashboardDeadlineRoot | null | undefined): DashboardDeadlineRoot {
  if (!root) return { upcoming: [], stats: { ...EMPTY_DEADLINE_STATS } };
  if (!Array.isArray(root.upcoming)) root.upcoming = [];
  if (!root.stats) root.stats = { ...EMPTY_DEADLINE_STATS };
  return root;
}

function recalculateDeadlineStats(root: DashboardDeadlineRoot, { now = new Date() }: ProjectionOptions = {}): DashboardDeadlineRoot {
  const { today, weekFromNow } = dateWindow(now);
  let dueToday = 0;
  let dueThisWeek = 0;
  let totalPoints = 0;
  for (const deadline of root.upcoming) {
    if (deadline._tombstone) continue;
    if (deadline.due_date === today) dueToday += 1;
    if (deadline.due_date && deadline.due_date >= today && deadline.due_date <= weekFromNow) dueThisWeek += 1;
    if (deadline.points_possible) totalPoints += deadline.points_possible;
  }
  root.stats = {
    incomplete: root.upcoming.filter((deadline) => !deadline._tombstone && deadline.status !== "complete").length,
    dueToday,
    dueThisWeek,
    totalPoints,
  };
  return root;
}

export function applyDeadlineUpsert(
  root: DashboardDeadlineRoot,
  deadline: DashboardDeadline,
  { merge = false, now = new Date() }: ProjectionOptions & { merge?: boolean } = {},
): DashboardDeadlineRoot {
  if (!deadline?.id) return root;
  // A merge means "update the existing live entry" — if the only cache
  // entry for this id is a tombstone (a completed recurring occurrence's
  // historical snapshot, see server/tasks/tombstones.ts), there is no live
  // entry to merge onto. Bail out with the same reference instead of pushing
  // a fresh entry beside the tombstone. Reachable via handleUpdateTask: the
  // deadline detail views offer "Edit" on a completed/tombstoned occurrence
  // with no gating, and its save round-trip (see submitAddTaskFlow.ts's
  // `{ ...editingTask, ...task }`) preserves the tombstone's `_tombstone`
  // flag onto the submitted deadline when the task's live sibling occurrence
  // isn't in the cached range. (handleMoveTask can't reach this: drag is
  // disallowed for recurring/completed items, and tombstones are always
  // both.) Non-merge upserts (explicit re-add via handleAddTask) are
  // unaffected — pushing a fresh live entry beside a tombstone is the
  // intended, correct outcome there (see the pinning test below).
  if (merge && root?.upcoming?.length) {
    const hasLiveMatch = root.upcoming.some(
      (entry) => !entry._tombstone && String(entry.id) === String(deadline.id),
    );
    if (!hasLiveMatch) {
      const hasTombstoneMatch = root.upcoming.some(
        (entry) => entry._tombstone && String(entry.id) === String(deadline.id),
      );
      if (hasTombstoneMatch) return root;
    }
  }
  const updated = clone(root || EMPTY_DEADLINES);
  const deadlines = ensureDeadlineRoot(updated);
  const index = deadlines.upcoming.findIndex(
    (entry) => !entry._tombstone && String(entry.id) === String(deadline.id),
  );
  if (index >= 0) {
    deadlines.upcoming[index] = merge ? { ...deadlines.upcoming[index], ...deadline } : deadline;
  } else {
    deadlines.upcoming.push(deadline);
  }
  return recalculateDeadlineStats(deadlines, { now });
}

export function applyDeadlineDelete(
  root: DashboardDeadlineRoot,
  deadlineId: unknown,
  { now = new Date() }: ProjectionOptions = {},
): DashboardDeadlineRoot {
  if (!root?.upcoming) return root;
  const updated = clone(root);
  updated.upcoming = updated.upcoming.filter(
    (deadline) => deadline._tombstone || String(deadline.id) !== String(deadlineId),
  );
  return recalculateDeadlineStats(updated, { now });
}

export function applyDeadlineCompleting(
  root: DashboardDeadlineRoot,
  deadlineId: unknown,
): DashboardDeadlineRoot {
  if (!root) return root;
  const updated = clone(root);
  const deadline = updated.upcoming?.find((entry) => deadlineMatches(entry, deadlineId));
  if (deadline) deadline._completing = true;
  return updated;
}

export function clearDeadlineCompleting(
  root: DashboardDeadlineRoot,
  deadlineId: unknown,
): DashboardDeadlineRoot {
  if (!root) return root;
  // Identity no-op when the deadline is gone: skip the clone entirely so a
  // failed-completion revert that races an in-flight refetch doesn't hand the
  // range cache a fresh reference to republish (see applyDeadlineComplete).
  const index = root.upcoming?.findIndex((entry) => deadlineMatches(entry, deadlineId)) ?? -1;
  if (index < 0) return root;
  const updated = clone(root);
  delete updated.upcoming[index]!._completing;
  return updated;
}

export function applyDeadlineComplete(
  root: DashboardDeadlineRoot,
  deadlineId: unknown,
  { now = new Date() }: ProjectionOptions = {},
): DashboardDeadlineRoot {
  if (!root) return root;
  // Identity no-op when the deadline is gone (e.g. the 600ms post-complete
  // timer fires after a refetch already dropped the task): return the SAME
  // reference so callers can skip the cache write, instead of clone()-ing the
  // whole root just to hand back a deep-equal-but-new object every time.
  const index = root.upcoming?.findIndex((entry) => deadlineMatches(entry, deadlineId)) ?? -1;
  if (index < 0) return root;
  const updated = clone(root);
  const deadline = updated.upcoming[index]!;
  deadline.status = "complete";
  delete deadline._completing;
  return recalculateDeadlineStats(updated, { now });
}
