import { useCallback, useEffect, useRef, useState } from "react";
import { getSnapshot, type Editor, type TLStore } from "tldraw";
import { saveTldrawDocument } from "../../api";
import type { TldrawDocumentJson } from "../../../shared/types/tldraw";
import {
  tldrawRecoveryStore,
  type TldrawRecoveryStore,
} from "./tldrawRecoveryStore";
import type { TldrawRecoveryDraft } from "./tldrawRecoveryModel";

const LOCAL_RECOVERY_MS = 350;
const QUIET_SAVE_MS = 5_000;
const MAX_SAVE_WAIT_MS = 30_000;
const SAVED_CONFIRMATION_MS = 3_000;
const SESSION_STORAGE_KEY = "ea:tldraw-session";

export type TldrawSaveState = "idle" | "saving" | "saved" | "conflict" | "error";
export type TldrawRecoveryState = "safe" | "pending" | "error";

function documentSnapshot(store: TLStore): TldrawDocumentJson {
  return getSnapshot(store).document as unknown as TldrawDocumentJson;
}

function recoveryId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  initialRecoveryDraft = null,
  recoveryStore = tldrawRecoveryStore,
}: {
  store: TLStore;
  initialRevision: number;
  initialDocument: TldrawDocumentJson | null;
  initialRecoveryDraft?: TldrawRecoveryDraft | null;
  recoveryStore?: Pick<TldrawRecoveryStore, "write" | "clearIfCurrent">;
}) {
  const [state, setState] = useState<TldrawSaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [recoveryState, setRecoveryState] = useState<TldrawRecoveryState>("safe");
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const revisionRef = useRef(initialRevision);
  const lastSavedRef = useRef(initialDocument ? JSON.stringify(initialDocument) : null);
  const dirtyRef = useRef(Boolean(initialRecoveryDraft));
  const inFlightRef = useRef(false);
  const disposedRef = useRef(false);
  const conflictRef = useRef(false);
  const localSafeRef = useRef(Boolean(initialRecoveryDraft));
  const changeVersionRef = useRef(0);
  const currentRecoveryIdRef = useRef(initialRecoveryDraft?.id ?? null);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const persistRecoveryRef = useRef<() => Promise<void>>(async () => {});

  const clearServerTimers = useCallback(() => {
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    quietTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
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

  const scheduleServerSave = useCallback(() => {
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(() => void flushRef.current(), QUIET_SAVE_MS);
    if (!maxTimerRef.current) {
      maxTimerRef.current = setTimeout(() => void flushRef.current(), MAX_SAVE_WAIT_MS);
    }
  }, []);

  const scheduleRecovery = useCallback(() => {
    if (recoveryTimerRef.current) return;
    recoveryTimerRef.current = setTimeout(() => void persistRecoveryRef.current(), LOCAL_RECOVERY_MS);
  }, []);

  const persistRecovery = useCallback(async () => {
    clearRecoveryTimer();
    if ((!dirtyRef.current && !inFlightRef.current) || conflictRef.current) return;
    const document = documentSnapshot(store);
    const version = changeVersionRef.current;
    const id = recoveryId();
    const draft: TldrawRecoveryDraft = {
      version: 1,
      id,
      document,
      baseRevision: revisionRef.current,
      updatedAt: new Date().toISOString(),
    };
    currentRecoveryIdRef.current = id;
    if (!localSafeRef.current && !disposedRef.current) setRecoveryState("pending");
    try {
      await recoveryStore.write(draft);
      if (version === changeVersionRef.current) {
        localSafeRef.current = true;
        if (!disposedRef.current) {
          setRecoveryState("safe");
          setRecoveryMessage(null);
        }
      } else if (!disposedRef.current) {
        scheduleRecovery();
      }
    } catch {
      if (version === changeVersionRef.current) localSafeRef.current = false;
      if (!disposedRef.current) {
        setRecoveryState("error");
        setRecoveryMessage("Local recovery is unavailable. Keep this page open until Notes is saved, or retry protection.");
      }
    }
  }, [clearRecoveryTimer, recoveryStore, scheduleRecovery, store]);

  persistRecoveryRef.current = persistRecovery;

  const clearConfirmedRecovery = useCallback((draftId: string | null) => {
    if (!draftId) return;
    void recoveryStore.clearIfCurrent(draftId).catch(() => {
      // The server copy is already durable. A stale local envelope is reconciled on next bootstrap.
    });
  }, [recoveryStore]);

  const flush = useCallback(async () => {
    if (disposedRef.current || conflictRef.current || inFlightRef.current || !dirtyRef.current) return;
    clearServerTimers();
    const document = documentSnapshot(store);
    const serialized = JSON.stringify(document);
    const savedVersion = changeVersionRef.current;
    const savedRecoveryId = currentRecoveryIdRef.current;
    dirtyRef.current = false;
    if (serialized === lastSavedRef.current) {
      localSafeRef.current = true;
      clearRecoveryTimer();
      clearConfirmedRecovery(savedRecoveryId);
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
      if (savedVersion === changeVersionRef.current && !dirtyRef.current) {
        localSafeRef.current = true;
        clearRecoveryTimer();
        clearConfirmedRecovery(savedRecoveryId);
      } else {
        // A newer local draft was based on the just-saved revision. Rewrite its
        // envelope against the new revision before considering it protected.
        localSafeRef.current = false;
        if (!disposedRef.current) setRecoveryState("pending");
        void persistRecoveryRef.current();
      }
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
          setMessage(localSafeRef.current
            ? "Server save failed. A recovery copy is stored on this device; Setpoint will retry after your next change."
            : "Notes could not be saved or protected locally. Keep this page open and try another change.");
        }
      }
    } finally {
      inFlightRef.current = false;
      if (dirtyRef.current && !conflictRef.current && !disposedRef.current) scheduleServerSave();
    }
  }, [clearConfirmedRecovery, clearRecoveryTimer, clearServerTimers, scheduleServerSave, showSavedConfirmation, store]);

  flushRef.current = flush;

  const markDirty = useCallback(() => {
    if (disposedRef.current || conflictRef.current) return;
    clearSavedTimer();
    setState((current) => current === "saved" || current === "error" ? "idle" : current);
    dirtyRef.current = true;
    changeVersionRef.current += 1;
    localSafeRef.current = false;
    setRecoveryState("pending");
    setRecoveryMessage(null);
    scheduleRecovery();
    scheduleServerSave();
  }, [clearSavedTimer, scheduleRecovery, scheduleServerSave]);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    if (initialRecoveryDraft) {
      scheduleServerSave();
      if (initialRecoveryDraft.baseRevision !== initialRevision) void persistRecoveryRef.current();
    } else if (!initialDocument) {
      requestAnimationFrame(markDirty);
    }
  }, [initialDocument, initialRecoveryDraft, initialRevision, markDirty, scheduleServerSave]);

  useEffect(() => {
    disposedRef.current = false;
    const stop = store.listen(markDirty, { source: "user", scope: "document" });
    if (dirtyRef.current && !inFlightRef.current) scheduleServerSave();
    if (dirtyRef.current && !localSafeRef.current) scheduleRecovery();

    const saveLocalSession = () => {
      if (editorRef.current) saveSession(editorRef.current);
    };
    const onPageHide = () => {
      saveLocalSession();
      void persistRecoveryRef.current();
      void flushRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onPageHide();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if ((!dirtyRef.current && !inFlightRef.current) || localSafeRef.current) return;
      void persistRecoveryRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      saveLocalSession();
      void persistRecoveryRef.current();
      void flushRef.current();
      disposedRef.current = true;
      clearServerTimers();
      clearRecoveryTimer();
      clearSavedTimer();
      stop();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clearRecoveryTimer, clearSavedTimer, clearServerTimers, markDirty, scheduleRecovery, scheduleServerSave, store]);

  const downloadRecovery = useCallback(() => {
    const blob = new Blob([JSON.stringify({ document: documentSnapshot(store) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `setpoint-notes-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [store]);

  const retryRecovery = useCallback(() => {
    localSafeRef.current = false;
    setRecoveryState("pending");
    setRecoveryMessage(null);
    void persistRecoveryRef.current();
  }, []);

  return {
    state,
    message,
    recoveryState,
    recoveryMessage,
    onMount,
    downloadRecovery,
    retryRecovery,
  };
}
