import { daysLabel } from "../../../../lib/shell-helpers";
import type { DeadlineItem } from "./deadlinesModel";

export function deadlineTitle(task: DeadlineItem): string {
  return task.title || task.name || "Untitled task";
}

export function deadlineContextLabel(task: DeadlineItem): string | null {
  return task.class_name || task.project_name || null;
}

export function deadlineDueBadgeLabel(task: DeadlineItem, dueDays: number | null): string {
  if (task?.status === "complete") return "Complete";
  return task.due_date ? daysLabel(dueDays) : "No due date";
}

export function deadlineDueDetailLabel(task: DeadlineItem): string {
  if (!task.due_date) return "No due date";
  return task.due_time || "End of day";
}

export function deadlineSecondaryMeta(task: DeadlineItem): string | null {
  return deadlineContextLabel(task);
}

export function shouldCompressDeadlineCard(task?: DeadlineItem | null): boolean {
  if (!task) return false;
  const title = deadlineTitle(task);
  const contextLabel = deadlineContextLabel(task) || "";
  const titleWordCount = title.split(/\s+/).filter(Boolean).length;

  return Boolean(
    title.length >= 24
    || titleWordCount >= 4
    || contextLabel.length >= 28
    || deadlineDueDetailLabel(task).length >= 14
  );
}
