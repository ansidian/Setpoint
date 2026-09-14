import { useCallback, useEffect, useRef, useState } from "react";
import { batchTargets, emailSelectionKey, type BatchAction } from "./inboxBatchModel";
import { buildBatchCommand, settleBatch, type BatchCommand, type BatchPatch } from "./inboxBatchCommands";
import type { InboxEmailLike } from "./inboxTypes";
import type { InboxUndoController } from "./useInboxUndoSlot";

interface BatchOverlay {
  command: BatchCommand;
  patch: BatchPatch;
  pending: boolean;
  restore: boolean;
  scope: string;
}

export default function useInboxBatchActions({ sourceEmails, scope, readOnly, replaceUndoSlot, finalizeUndoSlot, undoSlotRef, undoing, refresh, updateRead }: {
  sourceEmails: InboxEmailLike[];
  scope: string;
  readOnly: boolean;
  replaceUndoSlot: InboxUndoController["replaceUndoSlot"];
  finalizeUndoSlot: InboxUndoController["finalizeUndoSlot"];
  undoSlotRef: InboxUndoController["undoSlotRef"];
  undoing: boolean;
  refresh: () => unknown | Promise<unknown>;
  updateRead: (uid: string, read: boolean) => void;
}) {
  const [overlays, setOverlays] = useState<ReadonlyMap<string, BatchOverlay>>(new Map());
  const [pendingEmails, setPendingEmails] = useState<readonly InboxEmailLike[]>([]);
  const [feedback, setFeedback] = useState("");
  const running = useRef(false);
  const alive = useRef(true);
  const feedbackVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; setFeedback(""); }; }, []);
  useEffect(() => {
    feedbackVersion.current++;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear operation feedback when its owning view changes
    setFeedback("");
  }, [scope]);

  // Release confirmed overlays; provider state resumes ownership as soon as it
  // reflects the mutation. Pending writes survive intervening SSE refreshes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile optimistic writes with refreshed provider rows
    setOverlays(previous => {
      const next = new Map(previous);
      for (const [key, overlay] of previous) {
        if (overlay.pending) continue;
        const candidates = sourceEmails.filter(row => emailSelectionKey(row) === emailSelectionKey(overlay.command.email)
          && (!overlay.command.snapshotOnly || row.snapshot_item_id === overlay.command.email.snapshot_item_id));
        if (!candidates.length) {
          if (overlay.patch.hidden && !overlay.restore) next.delete(key);
          continue;
        }
        const matches = candidates.every(row => Object.entries(overlay.patch).every(([field, value]) => field === "hidden" ? !value : field === "handled_at" || field === "_pinned" ? !!row[field] === !!value : row[field as keyof InboxEmailLike] === value));
        if (matches) next.delete(key);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [sourceEmails]);

  const projectRows = useCallback((rows: InboxEmailLike[], includeRestored = false): InboxEmailLike[] => {
    const projected = [...rows];
    for (const overlay of overlays.values()) {
      const { command, patch } = overlay;
      const uid = emailSelectionKey(command.email);
      const index = projected.findIndex(row => emailSelectionKey(row) === uid && (!command.snapshotOnly || row.snapshot_item_id === command.email.snapshot_item_id));
      if (index < 0) {
        if (includeRestored && overlay.restore && !patch.hidden && overlay.scope === scope) projected.push({ ...command.email, ...patch });
        continue;
      }
      if (patch.hidden) projected.splice(index, 1);
      else projected[index] = { ...projected[index], ...patch, _optimisticSnapshotPending: overlay.pending || projected[index]?._optimisticSnapshotPending };
    }
    return projected;
  }, [overlays, scope]);

  const execute = useCallback(async (emails: readonly InboxEmailLike[], action: BatchAction) => {
    if (running.current || undoSlotRef.current?.status === "undoing") return;
    const commands = batchTargets(emails, action, readOnly).map(email => buildBatchCommand(email, action));
    if (!commands.length) return;
    running.current = true;
    const version = ++feedbackVersion.current;
    setFeedback("");
    setPendingEmails(commands.map(command => command.email));
    const report = (message: string) => {
      if (alive.current && version === feedbackVersion.current) setFeedback(message);
    };
    const keyFor = (command: BatchCommand) => `${emailSelectionKey(command.email)}:${command.snapshotOnly ? command.email.snapshot_item_id : "provider"}:${Object.keys(command.patch).join(",")}`;
    const paint = (items: readonly BatchCommand[], previous: boolean, pending: boolean) => {
      setOverlays(old => {
        const next = new Map(old);
        for (const command of items) next.set(keyFor(command), { command, patch: previous ? command.previous : command.patch, pending, restore: previous, scope });
        return next;
      });
      for (const command of items) {
        const patch = previous ? command.previous : command.patch;
        if (patch.read !== undefined) updateRead(emailSelectionKey(command.email), patch.read);
      }
    };
    const reconcile = async () => {
      try { await refresh(); return true; }
      catch { return false; }
    };
    const finish = () => { running.current = false; setPendingEmails([]); };
    // Settle the previous Undo slot before installing this operation.
    finalizeUndoSlot();
    paint(commands, false, true);
    if (action === "trash") {
      replaceUndoSlot({
        type: "batch-trash", refreshOnError: false, message: `${commands.length} ${commands.length === 1 ? "email" : "emails"} moved to trash`,
        undo: async () => { paint(commands, true, false); finish(); },
        commit: async () => {
          const result = await settleBatch(commands);
          paint(result.succeeded, false, false);
          paint(result.failed, true, false);
          const refreshed = await reconcile();
          finish();
          if (result.failed.length) throw new Error(`${result.succeeded.length} moved to trash; ${result.failed.length} failed. Failed emails restored.`);
          if (!refreshed) throw new Error("Emails moved to trash; inbox refresh failed.");
        },
        commitOnExit: () => { for (const command of commands) command.onExit?.(); finish(); },
      });
      return;
    }
    const result = await settleBatch(commands);
    paint(result.failed, true, false);
    paint(result.succeeded, false, false);
    const refreshed = await reconcile();
    const message = `${result.succeeded.length} ${result.succeeded.length === 1 ? "email" : "emails"} updated${result.failed.length ? `; ${result.failed.length} failed` : ""}${refreshed ? "" : "; inbox refresh failed"}`;
    if (!result.succeeded.length) report(message);
    if (result.succeeded.length && alive.current) replaceUndoSlot({
      type: `batch-${action}`, refreshOnError: false, message,
      undo: async () => {
        if (running.current) throw new Error("Wait for the current batch to finish before undoing.");
        running.current = true;
        setPendingEmails(result.succeeded.map(command => command.email));
        const undone = await settleBatch(result.succeeded, true);
        paint(undone.succeeded, true, false);
        const refreshedUndo = await reconcile();
        finish();
        if (undone.failed.length) throw new Error(`${undone.succeeded.length} undone; ${undone.failed.length} could not be undone.`);
        if (!refreshedUndo) throw new Error("Undo completed; inbox refresh failed.");
      },
    });
    finish();
  }, [readOnly, scope, replaceUndoSlot, finalizeUndoSlot, undoSlotRef, refresh, updateRead]);

  return { projectRows, pendingEmails, busy: pendingEmails.length > 0 || undoing, execute, feedback };
}
