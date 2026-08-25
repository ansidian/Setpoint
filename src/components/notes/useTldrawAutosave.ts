import { useCallback, useEffect, useRef, useState } from "react";
import { getSnapshot, type Editor, type TLStore } from "tldraw";
import { saveTldrawDocument } from "../../api";
import type { TldrawDocumentJson } from "../../../shared/types/tldraw";

const QUIET_SAVE_MS = 5_000;
const MAX_SAVE_WAIT_MS = 30_000;
const SAVED_CONFIRMATION_MS = 3_000;
const SESSION_STORAGE_KEY = "ea:tldraw-session";

export type TldrawSaveState = "idle" | "saving" | "saved" | "conflict" | "error";

function documentSnapshot(store: TLStore): TldrawDocumentJson {
  return getSnapshot(store).document as unknown as TldrawDocumentJson;
}

function readSession(): unknown | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function saveSession(editor: Editor): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(getSnapshot(editor.store).session));
  } catch {
    // Camera and selected-page persistence is optional when storage is unavailable.
  }
}

export function getStoredTldrawSession(): unknown | null {
  return readSession();
}

export function useTldrawAutosave({
  store,
  initialRevision,
  initialDocument,
}: {
  store: TLStore;
  initialRevision: number;
  initialDocument: TldrawDocumentJson | null;
}) {
  const [state, setState] = useState<TldrawSaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const revisionRef = useRef(initialRevision);
  const lastSavedRef = useRef(initialDocument ? JSON.stringify(initialDocument) : null);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const disposedRef = useRef(false);
  const conflictRef = useRef(false);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const clearTimers = useCallback(() => {
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    quietTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const clearSavedTimer = useCallback(() => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = null;
  }, []);

  const showSavedConfirmation = useCallback(() => {
    clearSavedTimer();
    setState("saved");
    savedTimerRef.current = setTimeout(() => {
      savedTimerRef.current = null;
      if (!disposedRef.current) setState("idle");
    }, SAVED_CONFIRMATION_MS);
  }, [clearSavedTimer]);

  const flush = useCallback(async () => {
    if (disposedRef.current || conflictRef.current || inFlightRef.current || !dirtyRef.current) return;
    clearTimers();
    const document = documentSnapshot(store);
    const serialized = JSON.stringify(document);
    dirtyRef.current = false;
    if (serialized === lastSavedRef.current) {
      setState("idle");
      return;
    }

    inFlightRef.current = true;
    setState("saving");
    setMessage(null);
    try {
      const result = await saveTldrawDocument({ document, baseRevision: revisionRef.current });
      revisionRef.current = result.revision;
      lastSavedRef.current = serialized;
      if (!disposedRef.current) {
        if (dirtyRef.current) setState("idle");
        else showSavedConfirmation();
      }
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : null;
      if (status === 409) {
        conflictRef.current = true;
        dirtyRef.current = false;
        if (!disposedRef.current) {
          setState("conflict");
          setMessage("This canvas changed on another device. Your local canvas has not overwritten it.");
        }
      } else {
        dirtyRef.current = true;
        if (!disposedRef.current) {
          setState("error");
          setMessage("Notes could not be saved. Setpoint will retry after your next change.");
        }
      }
    } finally {
      inFlightRef.current = false;
      if (dirtyRef.current && !conflictRef.current && !disposedRef.current) {
        quietTimerRef.current = setTimeout(() => void flushRef.current(), QUIET_SAVE_MS);
      }
    }
  }, [clearTimers, showSavedConfirmation, store]);

  flushRef.current = flush;

  const markDirty = useCallback(() => {
    if (disposedRef.current || conflictRef.current) return;
    clearSavedTimer();
    setState((current) => current === "saved" ? "idle" : current);
    dirtyRef.current = true;
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(() => void flushRef.current(), QUIET_SAVE_MS);
    if (!maxTimerRef.current) {
      maxTimerRef.current = setTimeout(() => void flushRef.current(), MAX_SAVE_WAIT_MS);
    }
  }, [clearSavedTimer]);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    if (!initialDocument) requestAnimationFrame(markDirty);
  }, [initialDocument, markDirty]);

  useEffect(() => {
    disposedRef.current = false;
    const stop = store.listen(markDirty, { source: "user", scope: "document" });
    const saveLocalSession = () => {
      if (editorRef.current) saveSession(editorRef.current);
    };
    const onPageHide = () => {
      saveLocalSession();
      void flushRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onPageHide();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      saveLocalSession();
      void flushRef.current();
      disposedRef.current = true;
      clearTimers();
      clearSavedTimer();
      stop();
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clearSavedTimer, clearTimers, markDirty, store]);

  const downloadRecovery = useCallback(() => {
    const blob = new Blob([JSON.stringify({ document: documentSnapshot(store) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `setpoint-notes-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [store]);

  return { state, message, onMount, downloadRecovery };
}
