import { useCallback, useEffect, useRef, useState } from "react";

const INBOX_UNDO_WINDOW_MS = 6_000;
const ERROR_TOAST_MS = 4_000;

export default function useInboxUndoSlot({ onActiveSnapshotRefresh }) {
  const [undo, setUndo] = useState(null);
  const undoSlotRef = useRef(null);

  const showError = useCallback((slot, fallbackMessage) => {
    setUndo({
      id: slot?.id || `error-${Date.now()}`,
      message: slot?.message || fallbackMessage,
      status: "error",
      error: fallbackMessage,
    });
    setTimeout(() => setUndo(null), ERROR_TOAST_MS);
  }, []);

  const finalizeUndoSlot = useCallback((slot = undoSlotRef.current) => {
    if (!slot) return;
    if (slot.timerId) clearTimeout(slot.timerId);
    undoSlotRef.current = null;
    setUndo(null);
    if (slot.commit && !slot.committed) {
      slot.committed = true;
      slot.commit().catch((err) => {
        showError(slot, err?.message || "Action failed. Refreshed inbox state.");
        onActiveSnapshotRefresh?.();
      });
    }
  }, [onActiveSnapshotRefresh, showError]);

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
    const slot = undoSlotRef.current;
    if (slot?.timerId) clearTimeout(slot.timerId);
    undoSlotRef.current = null;
  }, []);

  return {
    undo,
    undoSlotRef,
    replaceUndoSlot,
    onUndo,
  };
}
