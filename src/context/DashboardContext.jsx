import { createContext, useContext, useCallback, useEffect, useMemo, useRef } from "react";
import { completeDeadlineOccurrence, updateDeadline } from "../api";
import { buildDeadlineReschedulePayload } from "../components/calendar/views/deadlines/calendarDeadlineRescheduleModel.js";
import {
  EMPTY_DEADLINES,
  applyDeadlineComplete,
  applyDeadlineCompleting,
  applyDeadlineDelete,
  applyDeadlineUpsert,
  clearDeadlineCompleting,
  deadlineMatches,
} from "./dashboardTaskProjection.js";

const DashboardContext = createContext(null);

export function DashboardProvider({
  deadlines,
  setCalendarDeadlines,
  onTaskCompleted = null,
  onTaskCompletionIntent = null,
  children,
}) {
  // Ref-read so the action callbacks (and thus the context value) stay stable
  // across deadline refetches/optimistic edits — only setCalendarDeadlines
  // identity should ever recreate them.
  const deadlinesRef = useRef(deadlines);
  useEffect(() => {
    deadlinesRef.current = deadlines;
  });

  // Pending 600ms post-complete removal timers (see handleCompleteTask),
  // keyed by their setTimeout id so they can be cancelled on unmount — an
  // in-flight timer firing after unmount would call a stale setCalendarDeadlines
  // closure against an unmounted tree.
  const completionTimersRef = useRef(new Set());
  useEffect(() => {
    const timers = completionTimersRef.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  // Single owner: every task mutation funnels through this one apply so the
  // calendar-deadlines domain cache is the only optimistic store — no surface
  // can drift from another. When the cache is still empty (dashboard rendering
  // the live fallback), seed it from the current deadlines view so optimistic
  // flags like _completing are never lost.
  const applyTaskMutation = useCallback((transform) => {
    setCalendarDeadlines?.((prev) => transform(prev || deadlinesRef.current || EMPTY_DEADLINES));
  }, [setCalendarDeadlines]);

  const removeCompletedTask = useCallback((taskId) => {
    // The 600ms timer that schedules this can fire after a refetch already
    // dropped the task from view (moved out of range, deleted, etc). Bail
    // before touching the store so a genuinely absent task never triggers a
    // cache write — applyDeadlineComplete is identity-no-op-safe on its own,
    // but useStaleDomainCache/useCalendarDomainRange don't compare identities,
    // so a same-reference return alone wouldn't stop the republish.
    const liveTask = deadlinesRef.current?.upcoming?.find((t) => deadlineMatches(t, taskId));
    if (!liveTask) return;

    // Keep completed tasks visible everywhere (dashboard + calendar): flip
    // status to "complete" and clear the transient _completing flash flag so
    // the row renders with the strikethrough/dim treatment.
    applyTaskMutation((root) => applyDeadlineComplete(root, taskId));
  }, [applyTaskMutation]);

  const handleCompleteTask = useCallback(async (taskId, taskSnapshot = null) => {
    const existingTask = deadlinesRef.current?.upcoming?.find((t) => deadlineMatches(t, taskId))
      || (deadlineMatches(taskSnapshot, taskId) ? taskSnapshot : null);
    if (!existingTask || !existingTask.due_date || existingTask._completing || existingTask.status === "complete") return;

    applyTaskMutation((root) => applyDeadlineCompleting(root, taskId));
    onTaskCompletionIntent?.(taskId);

    // Await the server so we can revert the optimistic flag on failure.
    // Swallowing this caused the "marked complete, refresh flips back" bug
    // upstream: if provider completion fails, the row must return to its pre-click
    // state instead of lingering as half-complete until the next refresh.
    try {
      await completeDeadlineOccurrence(taskId, existingTask.due_date);
    } catch (err) {
      console.error("[Briefing] Complete task failed:", err.message);
      applyTaskMutation((root) => clearDeadlineCompleting(root, taskId));
      return false;
    }

    onTaskCompleted?.(taskId);
    // Keep the 600ms UX delay (it drives the exit-flash treatment), but track
    // the id so an unmount can cancel it before it fires.
    const timerId = setTimeout(() => {
      completionTimersRef.current.delete(timerId);
      removeCompletedTask(taskId);
    }, 600);
    completionTimersRef.current.add(timerId);
    return true;
  }, [applyTaskMutation, onTaskCompleted, onTaskCompletionIntent, removeCompletedTask]);

  const handleUpdateTask = useCallback((updatedTask) => {
    applyTaskMutation((root) => applyDeadlineUpsert(root, updatedTask, { merge: true }));
  }, [applyTaskMutation]);

  // State-only: the panel owns the network call (matching create/update) so
  // it can surface "Failed to delete" inline without a second roundtrip.
  const handleDeleteTask = useCallback((taskId) => {
    applyTaskMutation((root) => applyDeadlineDelete(root, taskId));
  }, [applyTaskMutation]);

  const handleAddTask = useCallback((task) => {
    applyTaskMutation((root) => applyDeadlineUpsert(root, task));
  }, [applyTaskMutation]);

  // Day-only drag-reschedule: optimistically shift the due_date (the calendar
  // re-buckets the chip onto the target day), persist through Todoist, and roll
  // the date back if the server rejects. Mirrors handleCompleteTask's
  // optimistic→await→revert so the single deadlines store never half-commits.
  const handleMoveTask = useCallback(async (task, targetDate) => {
    const taskId = task?.id;
    if (!taskId || !targetDate) return;
    const existingTask = deadlinesRef.current?.upcoming?.find((t) => deadlineMatches(t, taskId)) || task;
    const originalDueDate = existingTask?.due_date ?? task?.due_date ?? null;
    // Same-day (or an undated source) → nothing to move.
    if (!originalDueDate || originalDueDate === targetDate) return;

    // Carry the whole task (not a minimal {id,due_date}): the month-range cache
    // applies this updater to every cached month, so the TARGET month — which
    // doesn't yet hold the task — would otherwise push a title-less stub that a
    // mounted adjacent-month preview block renders as "Untitled" until refetch.
    applyTaskMutation((root) => applyDeadlineUpsert(root, { ...existingTask, due_date: targetDate }, { merge: true }));

    try {
      await updateDeadline(taskId, buildDeadlineReschedulePayload(existingTask, targetDate));
    } catch (err) {
      console.error("[Briefing] Move task failed:", err.message);
      applyTaskMutation((root) => applyDeadlineUpsert(root, { ...existingTask, due_date: originalDueDate }, { merge: true }));
    }
  }, [applyTaskMutation]);

  const value = useMemo(() => ({
    handleCompleteTask,
    handleAddTask,
    handleUpdateTask,
    handleDeleteTask,
    handleMoveTask,
  }), [
    handleCompleteTask,
    handleAddTask,
    handleUpdateTask,
    handleDeleteTask,
    handleMoveTask,
  ]);

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
