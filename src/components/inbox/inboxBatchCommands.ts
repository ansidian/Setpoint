import { markEmailAsRead, markEmailAsUnread, trashEmail, trashEmailOnExit, moveSnapshotItemLane, dismissSnapshotItemForToday, restoreSnapshotItemForToday, markSnapshotItemHandled, reopenSnapshotItem, pinEmail, unpinEmail } from "../../api";
import { getSnapshotReopenLane } from "./activeSnapshotWorkflowModel";
import { buildEmailSnapshot } from "./inboxEmailSnapshot";
import { emailSelectionKey, type BatchAction } from "./inboxBatchModel";
import type { InboxEmailLike } from "./inboxTypes";

export type BatchPatch = Partial<InboxEmailLike> & { hidden?: boolean };
export interface BatchCommand {
  email: InboxEmailLike;
  patch: BatchPatch;
  previous: BatchPatch;
  snapshotOnly: boolean;
  run: () => Promise<unknown>;
  undo: () => Promise<unknown>;
  onExit?: () => void;
}

export function buildBatchCommand(email: InboxEmailLike, action: BatchAction): BatchCommand {
  const uid = emailSelectionKey(email);
  const itemId = email.snapshot_item_id!;
  const base = { email, snapshotOnly: false };
  if (action === "read" || action === "unread") return {
    ...base, patch: { read: action === "read" }, previous: { read: !!email.read },
    run: () => action === "read" ? markEmailAsRead(uid) : markEmailAsUnread(uid),
    undo: () => email.read ? markEmailAsRead(uid) : markEmailAsUnread(uid),
  };
  if (action === "pin" || action === "unpin") {
    const snapshot = buildEmailSnapshot(email);
    return {
      ...base, patch: { _pinned: action === "pin" }, previous: { _pinned: !!email._pinned },
      run: () => action === "pin" ? pinEmail(uid, snapshot) : unpinEmail(uid),
      undo: () => email._pinned ? pinEmail(uid, snapshot) : unpinEmail(uid),
    };
  }
  if (action === "trash") return {
    ...base, patch: { hidden: true }, previous: { hidden: false },
    run: () => trashEmail(uid), undo: async () => {}, onExit: () => trashEmailOnExit(uid),
  };
  if (action === "dismiss") return {
    ...base, snapshotOnly: true, patch: { hidden: true }, previous: { hidden: false },
    run: () => dismissSnapshotItemForToday(itemId), undo: () => restoreSnapshotItemForToday(itemId),
  };
  if (action === "handled" || action === "reopen") return {
    ...base, snapshotOnly: true,
    patch: { _lane: action === "handled" ? "handled" : getSnapshotReopenLane(email), handled_at: action === "handled" ? new Date().toISOString() : null },
    previous: { _lane: email._lane, handled_at: email.handled_at ?? null },
    run: () => action === "handled" ? markSnapshotItemHandled(itemId) : reopenSnapshotItem(itemId),
    undo: () => action === "handled" ? reopenSnapshotItem(itemId) : markSnapshotItemHandled(itemId),
  };
  const previousLane = getSnapshotReopenLane(email);
  return {
    ...base, snapshotOnly: true, patch: { _lane: action, lane: action }, previous: { _lane: email._lane, lane: email.lane },
    run: () => moveSnapshotItemLane(itemId, action), undo: () => moveSnapshotItemLane(itemId, previousLane),
  };
}

export async function settleBatch(commands: readonly BatchCommand[], undo = false) {
  const succeeded: BatchCommand[] = [];
  const failed: BatchCommand[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, commands.length) }, async () => {
    while (index < commands.length) {
      const command = commands[index++]!;
      try { await (undo ? command.undo() : command.run()); succeeded.push(command); }
      catch { failed.push(command); }
    }
  }));
  return { succeeded, failed };
}
