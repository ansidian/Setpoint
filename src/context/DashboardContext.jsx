import { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";
import { dismissEmail, completeTask, updateTaskStatus, dismissTombstone } from "../api";
import { markBriefingAccountEmailsRead, setBriefingEmailReadState } from "../lib/briefing-email-state";

const DashboardContext = createContext(null);

export function DashboardProvider({ briefing, setBriefing, setCalendarDeadlines, children }) {
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

  const removeCompletedTask = useCallback((taskId) => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const weekFromNow = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    // Keep completed tasks visible everywhere (dashboard + calendar): flip
    // status to "complete" and clear the transient _completing flash flag so
    // the row renders with the strikethrough/dim treatment.
    const finalizeComplete = (root) => {
      if (!root) return root;
      const updated = JSON.parse(JSON.stringify(root));
      for (const section of ["ctm", "todoist"]) {
        if (!updated[section]?.upcoming) continue;
        const task = updated[section].upcoming.find(
          t => !t._tombstone && (String(t.id) === String(taskId) || t.todoist_id === String(taskId))
        );
        if (task) {
          task.status = "complete";
          delete task._completing;
        }
        let totalPoints = 0, dueToday = 0, dueThisWeek = 0, incomplete = 0;
        for (const d of updated[section].upcoming) {
          if (d.status !== "complete") incomplete++;
          if (d.due_date === today) dueToday++;
          if (d.due_date >= today && d.due_date <= weekFromNow) dueThisWeek++;
          if (d.points_possible) totalPoints += d.points_possible;
        }
        updated[section].stats = { incomplete, dueToday, dueThisWeek, totalPoints };
      }
      return updated;
    };
    setBriefing(prev => finalizeComplete(prev));
    setCalendarDeadlines?.(prev => (prev ? finalizeComplete(prev) : prev));
  }, [setBriefing, setCalendarDeadlines]);

  const handleCompleteTask = useCallback(async (taskId) => {
    const existingTask = briefing?.todoist?.upcoming?.find(
      (t) => !t._tombstone && (String(t.id) === String(taskId) || t.todoist_id === String(taskId))
    ) || briefing?.ctm?.upcoming?.find(
      (t) => !t._tombstone && (String(t.id) === String(taskId) || t.todoist_id === String(taskId))
    );
    if (!existingTask || existingTask._completing || existingTask.status === "complete") return;

    const flagCompleting = (root) => {
      if (!root) return root;
      const updated = JSON.parse(JSON.stringify(root));
      for (const section of ["ctm", "todoist"]) {
        const task = updated[section]?.upcoming?.find(
          t => !t._tombstone && (String(t.id) === String(taskId) || t.todoist_id === String(taskId))
        );
        if (task) task._completing = true;
      }
      return updated;
    };
    setBriefing(prev => flagCompleting(prev));
    setCalendarDeadlines?.(prev => (prev ? flagCompleting(prev) : prev));
    if (expandedTask === taskId) setExpandedTask(null);

    // Await the server so we can revert the optimistic flag on failure.
    // Swallowing this caused the "marked complete, refresh flips back" bug
    // upstream — if Todoist close fails, the row must return to its pre-click
    // state instead of lingering as half-complete until the next refresh.
    try {
      await completeTask(taskId);
    } catch (err) {
      console.error("[Briefing] Complete task failed:", err.message);
      const clearCompleting = (root) => {
        if (!root) return root;
        const updated = JSON.parse(JSON.stringify(root));
        for (const section of ["ctm", "todoist"]) {
          const task = updated[section]?.upcoming?.find(
            t => !t._tombstone && (String(t.id) === String(taskId) || t.todoist_id === String(taskId))
          );
          if (task) delete task._completing;
        }
        return updated;
      };
      setBriefing(prev => clearCompleting(prev));
      setCalendarDeadlines?.(prev => (prev ? clearCompleting(prev) : prev));
      return;
    }

    setTimeout(() => removeCompletedTask(taskId), 600);
  }, [briefing?.ctm?.upcoming, briefing?.todoist?.upcoming, expandedTask, setBriefing, setCalendarDeadlines, removeCompletedTask]);

  const handleDismissGhost = useCallback((todoistId) => {
    dismissTombstone(todoistId).catch(() => {});
    const stripTombstone = (root) => {
      if (!root) return root;
      const updated = JSON.parse(JSON.stringify(root));
      if (updated.todoist?.upcoming) {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
        const weekFromNow = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
        updated.todoist.upcoming = updated.todoist.upcoming.filter(
          (t) => !(t._tombstone && t.id === todoistId),
        );
        let dueToday = 0, dueThisWeek = 0;
        for (const d of updated.todoist.upcoming) {
          if (d.due_date === today) dueToday++;
          if (d.due_date >= today && d.due_date <= weekFromNow) dueThisWeek++;
        }
        updated.todoist.stats = {
          incomplete: updated.todoist.upcoming.filter((t) => t.status !== "complete").length,
          dueToday,
          dueThisWeek,
          totalPoints: 0,
        };
      }
      return updated;
    };
    setBriefing((prev) => stripTombstone(prev));
    setCalendarDeadlines?.((prev) => (prev ? stripTombstone(prev) : prev));
  }, [setBriefing, setCalendarDeadlines]);

  const handleUpdateTask = useCallback((updatedTask) => {
    const applyUpdate = (root) => {
      if (!root) return root;
      const updated = JSON.parse(JSON.stringify(root));
      if (!updated.todoist?.upcoming) return updated;
      // Only match live rows — tombstones share the id with their live
      // next-occurrence and must be left alone by edits to the live row.
      const idx = updated.todoist.upcoming.findIndex(
        t => !t._tombstone && String(t.id) === String(updatedTask.id),
      );
      // Merge (don't replace) so local-only fields — status, _completing —
      // survive the edit. The server response intentionally omits `status`.
      if (idx >= 0) {
        updated.todoist.upcoming[idx] = {
          ...updated.todoist.upcoming[idx],
          ...updatedTask,
        };
      }

      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      const weekFromNow = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      let dueToday = 0, dueThisWeek = 0;
      for (const d of updated.todoist.upcoming) {
        if (d.due_date === today) dueToday++;
        if (d.due_date >= today && d.due_date <= weekFromNow) dueThisWeek++;
      }
      updated.todoist.stats = { incomplete: updated.todoist.upcoming.length, dueToday, dueThisWeek, totalPoints: 0 };
      return updated;
    };
    setBriefing(prev => applyUpdate(prev));
    setCalendarDeadlines?.(prev => (prev ? applyUpdate(prev) : prev));
  }, [setBriefing, setCalendarDeadlines]);

  // State-only: the panel owns the network call (matching create/update) so
  // it can surface "Failed to delete" inline without a second roundtrip.
  const handleDeleteTask = useCallback((taskId) => {
    const applyDelete = (root) => {
      if (!root?.todoist?.upcoming) return root;
      const updated = JSON.parse(JSON.stringify(root));
      updated.todoist.upcoming = updated.todoist.upcoming.filter(
        (t) => t._tombstone || String(t.id) !== String(taskId),
      );
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      const weekFromNow = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      let dueToday = 0, dueThisWeek = 0;
      for (const d of updated.todoist.upcoming) {
        if (d.due_date === today) dueToday++;
        if (d.due_date >= today && d.due_date <= weekFromNow) dueThisWeek++;
      }
      updated.todoist.stats = {
        incomplete: updated.todoist.upcoming.filter((t) => !t._tombstone && t.status !== "complete").length,
        dueToday,
        dueThisWeek,
        totalPoints: 0,
      };
      return updated;
    };
    setBriefing((prev) => applyDelete(prev));
    setCalendarDeadlines?.((prev) => (prev ? applyDelete(prev) : prev));
    if (String(expandedTask) === String(taskId)) setExpandedTask(null);
  }, [expandedTask, setBriefing, setCalendarDeadlines]);

  const handleAddTask = useCallback((task) => {
    setBriefing(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      if (!updated.todoist) updated.todoist = { upcoming: [], stats: { incomplete: 0, dueToday: 0, dueThisWeek: 0, totalPoints: 0 } };
      updated.todoist.upcoming.push(task);

      // Recalculate stats
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      const weekFromNow = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      let dueToday = 0, dueThisWeek = 0;
      for (const d of updated.todoist.upcoming) {
        if (d.due_date === today) dueToday++;
        if (d.due_date >= today && d.due_date <= weekFromNow) dueThisWeek++;
      }
      updated.todoist.stats = { incomplete: updated.todoist.upcoming.length, dueToday, dueThisWeek, totalPoints: 0 };

      return updated;
    });
  }, [setBriefing]);

  const handleUpdateTaskStatus = useCallback(async (taskId, status) => {
    updateTaskStatus(taskId, status).catch(() => {});

    if (status === "complete") {
      const flagCompleting = (root) => {
        if (!root) return root;
        const updated = JSON.parse(JSON.stringify(root));
        const task = updated.ctm?.upcoming?.find(t => String(t.id) === String(taskId));
        if (task) task._completing = true;
        return updated;
      };
      setBriefing(prev => flagCompleting(prev));
      setCalendarDeadlines?.(prev => (prev ? flagCompleting(prev) : prev));
      setTimeout(() => removeCompletedTask(taskId), 600);
      if (String(expandedTask) === String(taskId)) setExpandedTask(null);
      return;
    }

    const applyStatus = (root) => {
      if (!root) return root;
      const updated = JSON.parse(JSON.stringify(root));
      const task = updated.ctm?.upcoming?.find(t => String(t.id) === String(taskId));
      if (task) task.status = status;
      return updated;
    };
    setBriefing(prev => applyStatus(prev));
    setCalendarDeadlines?.(prev => (prev ? applyStatus(prev) : prev));
  }, [expandedTask, setBriefing, setCalendarDeadlines, removeCompletedTask]);

  const emailAccounts = useMemo(
    () => briefing?.emails?.accounts || [],
    [briefing?.emails?.accounts],
  );
  const currentAccount = emailAccounts[activeAccount] || {
    important: [],
    noise: [],
    noise_count: 0,
    name: "",
    icon: "",
    color: "#cba6da",
    unread: 0,
  };

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

  return (
    <DashboardContext.Provider value={{
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
    }}>
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
