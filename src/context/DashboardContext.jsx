import { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";
import { dismissEmail, completeTask, updateTaskStatus, dismissTombstone } from "../api";
import { markBriefingAccountEmailsRead, setBriefingEmailReadState } from "../lib/briefing-email-state";
import {
  EMPTY_DEADLINES,
  applyTaskComplete,
  applyTaskCompleting,
  applyTaskStatus,
  applyTodoistTaskDelete,
  applyTodoistTaskUpsert,
  clearTaskCompleting,
  dismissTodoistTombstone,
  taskMatches,
} from "./dashboardTaskProjection.js";

const DashboardContext = createContext(null);

export function DashboardProvider({
  briefing,
  setBriefing,
  setCalendarDeadlines,
  onTaskCompleted = null,
  onTaskCompletionIntent = null,
  children,
}) {
  const [activeAccount, setActiveAccount] = useState(0);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loadingBillId, setLoadingBillId] = useState(null);
  const [confirmDismissId, setConfirmDismissId] = useState(null);
  const [expandedTask, setExpandedTask] = useState(null);
  const emailSectionRef = useRef(null);

  const recountUnread = (acct) => {
    acct.unread = (acct.important || []).filter((email) => !email.read).length;
  };

  const markAccountEmailsRead = useCallback(() => {
    setBriefing((prev) => markBriefingAccountEmailsRead(prev, activeAccount));
  }, [activeAccount, setBriefing]);

  const setEmailReadState = useCallback((emailKey, read) => {
    setBriefing((prev) => setBriefingEmailReadState(prev, emailKey, read));
  }, [setBriefing]);

  const markEmailRead = useCallback((emailKey) => setEmailReadState(emailKey, true), [setEmailReadState]);
  const markEmailUnread = useCallback((emailKey) => setEmailReadState(emailKey, false), [setEmailReadState]);

  const handleDismiss = useCallback(async (emailId) => {
    dismissEmail(emailId).catch(() => {});
    if (selectedEmail?.id === emailId) setSelectedEmail(null);
    setBriefing(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      for (const acct of updated.emails?.accounts || []) {
        acct.important = acct.important.filter(e => e.id !== emailId);
        recountUnread(acct);
      }
      return updated;
    });
  }, [selectedEmail, setBriefing]);

  const removeCompletedTask = useCallback((taskId, sectionName = null) => {
    // Keep completed tasks visible everywhere (dashboard + calendar): flip
    // status to "complete" and clear the transient _completing flash flag so
    // the row renders with the strikethrough/dim treatment.
    const finalizeComplete = (root) => applyTaskComplete(root, taskId, sectionName);
    setBriefing(prev => finalizeComplete(prev));
    setCalendarDeadlines?.(prev => (prev ? finalizeComplete(prev) : prev));
  }, [setBriefing, setCalendarDeadlines]);

  const handleCompleteTask = useCallback(async (taskId, taskSnapshot = null) => {
    const existingTask = briefing?.todoist?.upcoming?.find((t) => taskMatches(t, taskId, "todoist"))
      || (taskMatches(taskSnapshot, taskId, "todoist") ? taskSnapshot : null);
    if (!existingTask || existingTask._completing || existingTask.status === "complete") return;

    const flagCompleting = (root) => applyTaskCompleting(root, taskId, "todoist");
    setBriefing(prev => flagCompleting(prev));
    setCalendarDeadlines?.(prev => (prev ? flagCompleting(prev) : prev));
    if (expandedTask === taskId) setExpandedTask(null);
    onTaskCompletionIntent?.(taskId);

    // Await the server so we can revert the optimistic flag on failure.
    // Swallowing this caused the "marked complete, refresh flips back" bug
    // upstream — if Todoist close fails, the row must return to its pre-click
    // state instead of lingering as half-complete until the next refresh.
    try {
      await completeTask(taskId);
    } catch (err) {
      console.error("[Briefing] Complete task failed:", err.message);
      const clearCompleting = (root) => clearTaskCompleting(root, taskId, "todoist");
      setBriefing(prev => clearCompleting(prev));
      setCalendarDeadlines?.(prev => (prev ? clearCompleting(prev) : prev));
      return;
    }

    onTaskCompleted?.(taskId);
    setTimeout(() => removeCompletedTask(taskId, "todoist"), 600);
  }, [briefing?.todoist?.upcoming, expandedTask, onTaskCompleted, onTaskCompletionIntent, setBriefing, setCalendarDeadlines, removeCompletedTask]);

  const handleDismissGhost = useCallback((todoistId) => {
    dismissTombstone(todoistId).catch(() => {});
    const stripTombstone = (root) => dismissTodoistTombstone(root, todoistId);
    setBriefing((prev) => stripTombstone(prev));
    setCalendarDeadlines?.((prev) => (prev ? stripTombstone(prev) : prev));
  }, [setBriefing, setCalendarDeadlines]);

  const handleUpdateTask = useCallback((updatedTask) => {
    setBriefing(prev => applyTodoistTaskUpsert(prev, updatedTask, { merge: true }));
    setCalendarDeadlines?.(prev => (prev ? applyTodoistTaskUpsert(prev, updatedTask, { merge: true }) : prev));
  }, [setBriefing, setCalendarDeadlines]);

  // State-only: the panel owns the network call (matching create/update) so
  // it can surface "Failed to delete" inline without a second roundtrip.
  const handleDeleteTask = useCallback((taskId) => {
    setBriefing((prev) => applyTodoistTaskDelete(prev, taskId));
    setCalendarDeadlines?.((prev) => (prev ? applyTodoistTaskDelete(prev, taskId) : prev));
    if (String(expandedTask) === String(taskId)) setExpandedTask(null);
  }, [expandedTask, setBriefing, setCalendarDeadlines]);

  const handleAddTask = useCallback((task) => {
    setBriefing(prev => applyTodoistTaskUpsert(prev, task));
    setCalendarDeadlines?.(prev => applyTodoistTaskUpsert(
      prev || EMPTY_DEADLINES,
      task,
    ));
  }, [setBriefing, setCalendarDeadlines]);

  const handleUpdateTaskStatus = useCallback(async (taskId, status) => {
    const statusUpdate = updateTaskStatus(taskId, status);

    if (status === "complete") {
      onTaskCompletionIntent?.(taskId);
      statusUpdate.then(() => onTaskCompleted?.(taskId)).catch(() => {});
      const flagCompleting = (root) => applyTaskCompleting(root, taskId, "ctm");
      setBriefing(prev => flagCompleting(prev));
      setCalendarDeadlines?.(prev => (prev ? flagCompleting(prev) : prev));
      setTimeout(() => removeCompletedTask(taskId, "ctm"), 600);
      if (String(expandedTask) === String(taskId)) setExpandedTask(null);
      return;
    }

    statusUpdate.catch(() => {});

    const applyStatus = (root) => applyTaskStatus(root, taskId, status, "ctm");
    setBriefing(prev => applyStatus(prev));
    setCalendarDeadlines?.(prev => (prev ? applyStatus(prev) : prev));
  }, [expandedTask, onTaskCompleted, onTaskCompletionIntent, setBriefing, setCalendarDeadlines, removeCompletedTask]);

  const emailAccounts = useMemo(
    () => briefing?.emails?.accounts || [],
    [briefing?.emails?.accounts],
  );
  const currentAccount = useMemo(() => emailAccounts[activeAccount] || {
    important: [],
    noise: [],
    noise_count: 0,
    name: "",
    icon: "",
    color: "#cba6da",
    unread: 0,
  }, [activeAccount, emailAccounts]);

  const totalNoiseCount = useMemo(
    () => emailAccounts.reduce((sum, acc) => sum + (acc.noise?.length || 0), 0),
    [emailAccounts],
  );

  const billEmails = useMemo(() =>
    emailAccounts.flatMap((acc, accIdx) =>
      (acc.important || [])
        .filter((e) => e.hasBill)
        .map((e) => ({ ...e, accountColor: acc.color, _accIdx: accIdx })),
    ), [emailAccounts]);

  const totalBills = useMemo(() =>
    billEmails.reduce((sum, e) => sum + (e.extractedBill?.amount || 0), 0),
    [billEmails]);

  const value = useMemo(() => ({
    activeAccount,
    setActiveAccount,
    selectedEmail,
    setSelectedEmail,
    loadingBillId,
    setLoadingBillId,
    confirmDismissId,
    setConfirmDismissId,
    expandedTask,
    setExpandedTask,
    handleDismiss,
    handleCompleteTask,
    handleDismissGhost,
    handleAddTask,
    handleUpdateTask,
    handleDeleteTask,
    handleUpdateTaskStatus,
    markAccountEmailsRead,
    markEmailRead,
    markEmailUnread,
    emailAccounts,
    currentAccount,
    emailSectionRef,
    billEmails,
    totalBills,
    totalNoiseCount,
  }), [
    activeAccount,
    selectedEmail,
    loadingBillId,
    confirmDismissId,
    expandedTask,
    handleDismiss,
    handleCompleteTask,
    handleDismissGhost,
    handleAddTask,
    handleUpdateTask,
    handleDeleteTask,
    handleUpdateTaskStatus,
    markAccountEmailsRead,
    markEmailRead,
    markEmailUnread,
    emailAccounts,
    currentAccount,
    billEmails,
    totalBills,
    totalNoiseCount,
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
