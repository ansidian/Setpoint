import { createContext, useContext, useCallback, useMemo } from "react";
import { completeDeadlineOccurrence } from "../api";
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
  // Single owner: every task mutation funnels through this one apply so the
  // calendar-deadlines domain cache is the only optimistic store — no surface
  // can drift from another. When the cache is still empty (dashboard rendering
  // the live fallback), seed it from the current deadlines view so optimistic
  // flags like _completing are never lost.
  const applyTaskMutation = useCallback((transform) => {
    setCalendarDeadlines?.((prev) => transform(prev || deadlines || EMPTY_DEADLINES));
  }, [deadlines, setCalendarDeadlines]);

  const removeCompletedTask = useCallback((taskId) => {
    // Keep completed tasks visible everywhere (dashboard + calendar): flip
    // status to "complete" and clear the transient _completing flash flag so
    // the row renders with the strikethrough/dim treatment.
    applyTaskMutation((root) => applyDeadlineComplete(root, taskId));
  }, [applyTaskMutation]);

  const handleCompleteTask = useCallback(async (taskId, taskSnapshot = null) => {
    const existingTask = deadlines?.upcoming?.find((t) => deadlineMatches(t, taskId))
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
      return;
    }

    onTaskCompleted?.(taskId);
    setTimeout(() => removeCompletedTask(taskId), 600);
  }, [applyTaskMutation, deadlines?.upcoming, onTaskCompleted, onTaskCompletionIntent, removeCompletedTask]);

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

  const value = useMemo(() => ({
    handleCompleteTask,
    handleAddTask,
    handleUpdateTask,
    handleDeleteTask,
  }), [
    handleCompleteTask,
    handleAddTask,
    handleUpdateTask,
    handleDeleteTask,
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
