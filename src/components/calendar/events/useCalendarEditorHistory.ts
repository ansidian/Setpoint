import { useCallback, useEffect, useRef } from "react";
import type { CalendarView } from "../../../../shared/types/calendar";

interface UseCalendarEditorHistoryOptions {
  open: boolean;
  view: CalendarView;
  mode: "detail" | "editor";
  dirtySnapshot: string;
  titleInputPending: boolean;
  onPopState: () => void;
}

export default function useCalendarEditorHistory({
  open,
  view,
  mode,
  dirtySnapshot,
  titleInputPending,
  onPopState,
}: UseCalendarEditorHistoryOptions) {
  const dirtyBaselineRef = useRef<string | null>(null);
  const historyTokenRef = useRef<string | null>(null);
  const captureDirtyBaseline = useCallback((snapshot: string) => {
    dirtyBaselineRef.current = snapshot;
  }, []);
  /* eslint-disable react-hooks/refs -- baseline capture always accompanies editor state updates */
  const isDirty = mode === "editor"
    && !!dirtyBaselineRef.current
    && (dirtyBaselineRef.current !== dirtySnapshot || titleInputPending);
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function handlePopState() {
      if (!historyTokenRef.current) return;
      historyTokenRef.current = null;
      onPopState();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onPopState]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (mode === "editor" && open && view === "events") {
      if (historyTokenRef.current) return;
      const token = `ea-calendar-editor-${Date.now()}`;
      const currentState = window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
      window.history.pushState({ ...currentState, eaCalendarEditorToken: token }, "");
      historyTokenRef.current = token;
      return;
    }

    const token = historyTokenRef.current;
    if (!token) return;
    historyTokenRef.current = null;
    if (window.history.state?.eaCalendarEditorToken === token) {
      window.history.back();
    }
  }, [mode, open, view]);

  return { captureDirtyBaseline, isDirty };
}
