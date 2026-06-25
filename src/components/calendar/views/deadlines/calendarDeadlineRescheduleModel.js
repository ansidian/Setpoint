// Pure date-math + payload + drag-eligibility for deadline drag-reschedule.

// A drop only reschedules when it lands on a different, valid day. A same-day
// drop (or a missing source/target) resolves to null so the caller no-ops.
export function resolveDeadlineRescheduleTarget(sourceDate, targetDate) {
  if (!sourceDate || !targetDate || sourceDate === targetDate) return null;
  return targetDate;
}

// Day-only move: re-supply the existing 12h due_time so the server's
// due_string ([dueDate, dueTime].join(" ")) keeps the time instead of
// resetting the task to all-day. Omit dueTime entirely for all-day tasks.
export function buildDeadlineReschedulePayload(sourceItem, targetDate) {
  const payload = { dueDate: targetDate };
  if (sourceItem?.due_time) payload.dueTime = sourceItem.due_time;
  return payload;
}

// Recurring deadlines are excluded (a drag would shift the whole repeat
// pattern) as are completed ones; events are dragged by the event slice.
export function deadlineDragAllowed(item, dragEnabled) {
  return !!dragEnabled
    && item?.itemKind === "deadline"
    && !item.recurring
    && !item.complete;
}
