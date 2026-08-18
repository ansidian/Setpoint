import { createContext, useContext, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { completeDeadlineOccurrence, updateDeadline } from "../api";
import { buildDeadlineReschedulePayload } from "../components/calendar/views/deadlines/calendarDeadlineRescheduleModel.ts";
import {
  EMPTY_DEADLINES,
  applyDeadlineComplete,
  applyDeadlineCompleting,
  applyDeadlineDelete,
  applyDeadlineUpsert,
  clearDeadlineCompleting,
  deadlineMatches,
} from "./dashboardTaskProjection";
import type { DashboardDeadline, DashboardDeadlineRoot } from "./dashboardTaskProjection";

type DeadlineTransform = (current: DashboardDeadlineRoot) => DashboardDeadlineRoot;
type DeadlineUpdater = (current: DashboardDeadlineRoot | null | undefined) => DashboardDeadlineRoot;

export interface DashboardContextValue {
  handleCompleteTask: (taskId: string, taskSnapshot?: DashboardDeadline | null) => Promise<boolean | undefined>;
  handleAddTask: (task: DashboardDeadline) => void;
  handleUpdateTask: (updatedTask: DashboardDeadline) => void;
  handleDeleteTask: (taskId: string) => void;
  handleMoveTask: (task: DashboardDeadline, targetDate: string) => Promise<void>;
}

export interface DashboardProviderProps {
  deadlines?: DashboardDeadlineRoot | null;
  setCalendarDeadlines?: ((updater: DeadlineUpdater) => unknown) | null;
  onTaskCompleted?: ((taskId: string) => void) | null;
  onTaskCompletionIntent?: ((taskId: string) => void) | null;
  children: ReactNode;
  briefing?: unknown;
  setBriefing?: unknown;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

export function DashboardProvider({
  deadlines,
  setCalendarDeadlines,
  onTaskCompleted = null,
  onTaskCompletionIntent = null,
  children,
}: DashboardProviderProps) {
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
  const completionTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
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
  const applyTaskMutation = useCallback((transform: DeadlineTransform) => {
    setCalendarDeadlines?.((prev) => transform(prev || deadlinesRef.current || EMPTY_DEADLINES));
  }, [setCalendarDeadlines]);

  const removeCompletedTask = useCallback((taskId: string, occurrenceDate: string) => {
    // The 600ms timer that schedules this can fire after a refetch already
    // dropped the task from view (moved out of range, deleted, etc). Bail
    // before touching the store so a genuinely absent task never triggers a
    // cache write — applyDeadlineComplete is identity-no-op-safe on its own,
    // but useStaleDomainCache/useCalendarDomainRange don't compare identities,
    // so a same-reference return alone wouldn't stop the republish.
    const liveTask = deadlinesRef.current?.upcoming?.find((t) => deadlineMatches(t, taskId, occurrenceDate));
    if (!liveTask) return;

    // Keep completed tasks visible everywhere (dashboard + calendar): flip
    // status to "complete" and clear the transient _completing flash flag so
    // the row renders with the strikethrough/dim treatment.
    applyTaskMutation((root) => applyDeadlineComplete(root, taskId, { occurrenceDate }));
  }, [applyTaskMutation]);

  const handleCompleteTask = useCallback(async (taskId: string, taskSnapshot: DashboardDeadline | null = null) => {
    const existingTask = deadlinesRef.current?.upcoming?.find((t) => deadlineMatches(t, taskId))
      || (deadlineMatches(taskSnapshot, taskId) ? taskSnapshot : null);
    if (!existingTask || !existingTask.due_date || existingTask._completing || existingTask.status === "complete") return;
    const occurrenceDate = existingTask.due_date;

    applyTaskMutation((root) => applyDeadlineCompleting(root, taskId, occurrenceDate));
    onTaskCompletionIntent?.(taskId);

    // Await the server so we can revert the optimistic flag on failure.
    // Swallowing this caused the "marked complete, refresh flips back" bug
    // upstream: if provider completion fails, the row must return to its pre-click
    // state instead of lingering as half-complete until the next refresh.
    try {
      await completeDeadlineOccurrence(taskId, occurrenceDate);
    } catch (err: unknown) {
      console.error("[Briefing] Complete task failed:", errorMessage(err));
      applyTaskMutation((root) => clearDeadlineCompleting(root, taskId, occurrenceDate));
      return false;
    }

    onTaskCompleted?.(taskId);
    // Keep the 600ms UX delay (it drives the exit-flash treatment), but track
    // the id so an unmount can cancel it before it fires.
    const timerId = setTimeout(() => {
      completionTimersRef.current.delete(timerId);
      removeCompletedTask(taskId, occurrenceDate);
    }, 600);
    completionTimersRef.current.add(timerId);
    return true;
  }, [applyTaskMutation, onTaskCompleted, onTaskCompletionIntent, removeCompletedTask]);

  const handleUpdateTask = useCallback((updatedTask: DashboardDeadline) => {
    applyTaskMutation((root) => applyDeadlineUpsert(root, updatedTask, { merge: true }));
  }, [applyTaskMutation]);

  // State-only: the panel owns the network call (matching create/update) so
  // it can surface "Failed to delete" inline without a second roundtrip.
  const handleDeleteTask = useCallback((taskId: string) => {
    applyTaskMutation((root) => applyDeadlineDelete(root, taskId));
  }, [applyTaskMutation]);

  const handleAddTask = useCallback((task: DashboardDeadline) => {
    applyTaskMutation((root) => applyDeadlineUpsert(root, task));
  }, [applyTaskMutation]);

  // Day-only drag-reschedule: optimistically shift the due_date (the calendar
  // re-buckets the chip onto the target day), persist through Todoist, and roll
  // the date back if the server rejects. Mirrors handleCompleteTask's
  // optimistic→await→revert so the single deadlines store never half-commits.
  const handleMoveTask = useCallback(async (task: DashboardDeadline, targetDate: string) => {
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
    } catch (err: unknown) {
      console.error("[Briefing] Move task failed:", errorMessage(err));
      applyTaskMutation((root) => applyDeadlineUpsert(root, { ...existingTask, due_date: originalDueDate }, { merge: true }));
    }
  }, [applyTaskMutation]);

  const value = useMemo<DashboardContextValue>(() => ({
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

// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalDashboard() {
  return useContext(DashboardContext);
}
