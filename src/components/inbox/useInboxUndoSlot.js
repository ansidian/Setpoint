import { useCallback, useEffect, useRef, useState } from "react";

const INBOX_UNDO_WINDOW_MS = 6_000;
const ERROR_TOAST_MS = 4_000;

export default function useInboxUndoSlot({ onActiveSnapshotRefresh }) {
  const [undo, setUndo] = useState(null);
  const undoSlotRef = useRef(null);
  const settleUndoSlotRef = useRef(null);

  const showError = useCallback((slot, fallbackMessage) => {
    setUndo({
      id: slot?.id || `error-${Date.now()}`,
      message: slot?.message || fallbackMessage,
      status: "error",
      error: fallbackMessage,
    });
    setTimeout(() => setUndo(null), ERROR_TOAST_MS);
  }, []);

  const settleUndoSlot = useCallback((slot = undoSlotRef.current, {
    clearUi = true,
    reportErrors = true,
    useExitCommit = false,
  } = {}) => {
    if (!slot) return;
    if (slot.timerId) clearTimeout(slot.timerId);
    slot.timerId = null;
    undoSlotRef.current = null;
    if (clearUi) setUndo(null);
    if (slot.commit && !slot.committed) {
      slot.committed = true;
      const commit = useExitCommit && slot.commitOnExit ? slot.commitOnExit : slot.commit;
      try {
        Promise.resolve(commit()).catch((err) => {
          if (!reportErrors) return;
          showError(slot, err?.message || "Action failed. Refreshed inbox state.");
          onActiveSnapshotRefresh?.();
        });
      } catch (err) {
        if (reportErrors) {
          showError(slot, err?.message || "Action failed. Refreshed inbox state.");
          onActiveSnapshotRefresh?.();
        }
      }
    }
  }, [onActiveSnapshotRefresh, showError]);

  useEffect(() => {
    settleUndoSlotRef.current = settleUndoSlot;
  }, [settleUndoSlot]);

  const finalizeUndoSlot = useCallback((slot = undoSlotRef.current) => {
    settleUndoSlot(slot);
  }, [settleUndoSlot]);

  const replaceUndoSlot = useCallback((slotConfig) => {
    finalizeUndoSlot();
    const slot = {
      ...slotConfig,
      id: `${slotConfig.type}-${Date.now()}`,
      status: "ready",
      committed: false,
    };
    slot.timerId = setTimeout(() => finalizeUndoSlot(slot), INBOX_UNDO_WINDOW_MS);
    undoSlotRef.current = slot;
    setUndo({
      id: slot.id,
      message: slot.message,
      status: "ready",
      error: null,
    });
    return slot;
  }, [finalizeUndoSlot]);

  const onUndo = useCallback(async () => {
    const slot = undoSlotRef.current;
    if (!slot || slot.status === "undoing") return;
    slot.status = "undoing";
    if (slot.timerId) clearTimeout(slot.timerId);
    setUndo({
      id: slot.id,
      message: slot.message,
      status: "undoing",
      error: null,
    });
    try {
      await slot.undo?.();
      if (undoSlotRef.current?.id === slot.id) {
        undoSlotRef.current = null;
        setUndo(null);
      }
    } catch (err) {
      undoSlotRef.current = null;
      showError(slot, err?.message || "Undo failed. Refreshed inbox state.");
      onActiveSnapshotRefresh?.();
    }
  }, [onActiveSnapshotRefresh, showError]);

  useEffect(() => () => {
    settleUndoSlotRef.current?.(undoSlotRef.current, {
      clearUi: false,
      reportErrors: false,
    });
  }, []);

  useEffect(() => {
    const settleOnPageExit = () => {
      settleUndoSlotRef.current?.(undoSlotRef.current, {
        clearUi: true,
        reportErrors: false,
        useExitCommit: true,
      });
    };
    window.addEventListener("pagehide", settleOnPageExit);
    window.addEventListener("beforeunload", settleOnPageExit);
    return () => {
      window.removeEventListener("pagehide", settleOnPageExit);
      window.removeEventListener("beforeunload", settleOnPageExit);
    };
  }, []);

  return {
    undo,
    undoSlotRef,
    replaceUndoSlot,
    finalizeUndoSlot,
    onUndo,
  };
}
