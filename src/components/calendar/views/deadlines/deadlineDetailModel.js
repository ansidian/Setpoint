import { daysLabel } from "../../../../lib/shell-helpers";

export function deadlineTitle(task) {
  return task.title || task.name || "Untitled task";
}

export function deadlineContextLabel(task) {
  return task.class_name || task.project_name || null;
}

export function deadlineDueBadgeLabel(task, dueDays) {
  if (task?.status === "complete") return "Complete";
  return task.due_date ? daysLabel(dueDays) : "No due date";
}

export function deadlineDueDetailLabel(task) {
  if (!task.due_date) return "No due date";
  return task.due_time || "End of day";
}

export function deadlineSecondaryMeta(task) {
  return deadlineContextLabel(task);
}

export function shouldCompressDeadlineCard(task) {
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
