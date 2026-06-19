import { useEffect, useRef } from "react";
import { resolveDashboardShellHotkey } from "./dashboardShellModel.js";

// Global shell hotkeys: ⌘K palette, a analytics, y snapshots,
// g+key action chords (g+d deadline, g+e event) with a 900 ms chord window.
// Pure key→command resolution lives in dashboardShellModel; this hook owns the
// listener wiring and the chord state.
export default function useDashboardShellHotkeys({
  isMobile,
  analyticsOpen,
  historyOpen = false,
  anyBlockingOverlayOpen = false,
  openPalette,
  openAnalytics,
  closeAnalytics,
  openDeadlineCreate,
  openCalendar,
  setHistoryOpen,
  toggleAlfred,
  alfredNewChat,
}) {
  const actionChordRef = useRef(null);
  const actionChordTimerRef = useRef(null);

  useEffect(() => () => {
    if (actionChordTimerRef.current) clearTimeout(actionChordTimerRef.current);
  }, []);

  useEffect(() => {
    const clearActionChord = () => {
      actionChordRef.current = null;
      if (actionChordTimerRef.current) {
        clearTimeout(actionChordTimerRef.current);
        actionChordTimerRef.current = null;
      }
    };

    function onKey(e) {
      const target = e.target;
      const editableTarget = (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.isContentEditable
        || target.closest?.("[data-suspend-calendar-hotkeys='true']")
      );
      const command = resolveDashboardShellHotkey({
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        editableTarget,
        actionChord: actionChordRef.current,
        anyBlockingOverlayOpen,
        analyticsOpen,
        historyOpen,
      });

      if (command.action === "clear-chord") {
        clearActionChord();
        return;
      }
      if (command.action === "open-palette") {
        e.preventDefault();
        openPalette();
        return;
      }
      if (command.action === "toggle-alfred") {
        e.preventDefault();
        toggleAlfred();
        return;
      }
      if (command.action === "alfred-new-chat") {
        e.preventDefault();
        alfredNewChat();
        return;
      }
      if (command.clearChord) {
        clearActionChord();
      }
      if (command.action === "open-deadline-create") {
        e.preventDefault();
        openDeadlineCreate();
        return;
      }
      if (command.action === "open-event-create") {
        e.preventDefault();
        openCalendar("events", null, "new");
        return;
      }
      if (command.action === "start-g-chord") {
        actionChordRef.current = "g";
        actionChordTimerRef.current = setTimeout(clearActionChord, 900);
        e.preventDefault();
        return;
      }
      if (command.action === "toggle-analytics") {
        e.preventDefault();
        if (analyticsOpen) closeAnalytics();
        else void openAnalytics();
        return;
      }
      if (command.action === "toggle-history") { setHistoryOpen((v) => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyticsOpen, historyOpen, anyBlockingOverlayOpen, closeAnalytics, isMobile, openAnalytics, openPalette, openDeadlineCreate, toggleAlfred, alfredNewChat]);
}
