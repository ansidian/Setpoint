import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

const INBOX_UNDO_WINDOW_MS = 6_000;
const ERROR_TOAST_MS = 4_000;

type InboxUndoAction = () => unknown | Promise<unknown>;

export interface InboxUndoSlotConfig {
  type: string;
  message: string;
  commit?: InboxUndoAction;
  commitOnExit?: InboxUndoAction;
  undo?: InboxUndoAction;
}

export interface InboxUndoSlot extends InboxUndoSlotConfig {
  id: string;
  status: "ready" | "undoing";
  committed: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
}

export type InboxUndoPresentation =
  | { id: string; message: string; status: "ready" | "undoing"; error: null }
  | { id: string; message: string; status: "error"; error: string };

interface SettleOptions {
  clearUi?: boolean;
  reportErrors?: boolean;
  useExitCommit?: boolean;
}

export interface InboxUndoController {
  undo: InboxUndoPresentation | null;
  undoSlotRef: MutableRefObject<InboxUndoSlot | null>;
  replaceUndoSlot: (slot: InboxUndoSlotConfig) => InboxUndoSlot;
  finalizeUndoSlot: (slot?: InboxUndoSlot | null) => void;
  onUndo: () => Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function useInboxUndoSlot({ onActiveSnapshotRefresh }: {
  onActiveSnapshotRefresh?: () => unknown;
}): InboxUndoController {
  const [undo, setUndo] = useState<InboxUndoPresentation | null>(null);
  const undoSlotRef = useRef<InboxUndoSlot | null>(null);
  const settleUndoSlotRef = useRef<((slot?: InboxUndoSlot | null, options?: SettleOptions) => void) | null>(null);

  const showError = useCallback((slot: InboxUndoSlot | null | undefined, fallbackMessage: string) => {
    setUndo({
      id: slot?.id || `error-${Date.now()}`,
      message: slot?.message || fallbackMessage,
      status: "error",
      error: fallbackMessage,
    });
    setTimeout(() => setUndo(null), ERROR_TOAST_MS);
  }, []);

  const settleUndoSlot = useCallback((slot: InboxUndoSlot | null = undoSlotRef.current, {
    clearUi = true,
    reportErrors = true,
    useExitCommit = false,
  }: SettleOptions = {}) => {
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
          showError(slot, errorMessage(err, "Action failed. Refreshed inbox state."));
          onActiveSnapshotRefresh?.();
        });
      } catch (err) {
        if (reportErrors) {
          showError(slot, errorMessage(err, "Action failed. Refreshed inbox state."));
          onActiveSnapshotRefresh?.();
        }
      }
    }
  }, [onActiveSnapshotRefresh, showError]);

  useEffect(() => {
    settleUndoSlotRef.current = settleUndoSlot;
  }, [settleUndoSlot]);

  const finalizeUndoSlot = useCallback((slot: InboxUndoSlot | null = undoSlotRef.current) => {
    settleUndoSlot(slot);
  }, [settleUndoSlot]);

  const replaceUndoSlot = useCallback((slotConfig: InboxUndoSlotConfig): InboxUndoSlot => {
    finalizeUndoSlot();
    const slot: InboxUndoSlot = {
      ...slotConfig,
      id: `${slotConfig.type}-${Date.now()}`,
      status: "ready",
      committed: false,
      timerId: null,
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
      showError(slot, errorMessage(err, "Undo failed. Refreshed inbox state."));
      onActiveSnapshotRefresh?.();
    }
  }, [onActiveSnapshotRefresh, showError]);

  useEffect(() => () => {
    // React Activity runs effect cleanup when the Inbox keep-alive tab is
    // hidden but preserves component state. Clear every presentation here —
    // including slot-less error toasts — so returning to Inbox cannot restore
    // a toast whose action timer was already settled on leave.
    setUndo(null);
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
