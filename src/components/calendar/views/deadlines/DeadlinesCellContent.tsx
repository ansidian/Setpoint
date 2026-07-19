import { dueDateToMs } from "../../../../lib/shell-helpers";
import { DEADLINE_COLOR } from "./deadlinesModel.ts";
import type { CalendarChipItem } from "../../modal/CalendarCellItemChip";
import type { DeadlineItem } from "./deadlinesModel";

interface DeadlineGhost extends DeadlineItem {
  id: string;
  kind: "deadline";
  startDate: string;
  endDate: string;
  dueTime?: string | null;
  dueMinutes?: number | null;
  recurring?: boolean;
}
interface DeadlineDescriptor extends CalendarChipItem {
  itemKind: "deadline";
  detailKind: "deadline";
  sortMinutes: number;
  completeSort: number;
  upcomingReminderCount?: number;
  nextReminderAt?: string | null;
  reminderState?: string | null;
  sortMs?: number;
}

export function toDeadlineGhostDescriptor(ghost: DeadlineGhost): DeadlineDescriptor {
  const accent = ghost.color || DEADLINE_COLOR;
  return {
    id: ghost.id,
    isGhost: true,
    itemKind: "deadline",
    detailKind: "deadline",
    ghostKind: "deadline",
    ghostStart: ghost.startDate,
    ghostEnd: ghost.endDate,
    title: ghost.title || "Untitled",
    leadingLabel: ghost.dueTime || "Deadline",
    recurring: !!(ghost.recurring || ghost.is_recurring),
    accent,
    leadingColor: accent,
    complete: false,
    sortMinutes: typeof ghost.dueMinutes === "number" && Number.isFinite(ghost.dueMinutes) ? ghost.dueMinutes : Number.POSITIVE_INFINITY,
    sortMs: dueDateToMs(ghost.startDate, ghost.dueTime) ?? Number.POSITIVE_INFINITY,
    completeSort: 0,
  };
}
