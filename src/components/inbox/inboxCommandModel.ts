import { isCatchUpEmail } from "./helpers";
import type { InboxEmailLike, SnapshotOptimisticOverlay } from "./inboxTypes";

export type TrashCommand =
  | { allowed: false }
  | {
    allowed: true;
    scope: "live" | "activeSnapshot" | "briefing";
    uid: string | number | undefined;
    id?: string | number;
    itemId?: string | null;
    restoreSelectedId: string | number | undefined;
    refreshAfterCommit: boolean;
  };

export function buildTrashCommand(
  email: InboxEmailLike | null | undefined,
  { readOnly = false }: { readOnly?: boolean } = {},
): TrashCommand {
  if (!email || readOnly || email._snoozed || isCatchUpEmail(email)) {
    return { allowed: false };
  }
  const id = email.id;
  const uid = email.uid || id;
  const restoreSelectedId = id || uid;

  if (email._live) {
    return {
      allowed: true,
      scope: "live",
      uid,
      restoreSelectedId,
      refreshAfterCommit: true,
    };
  }

  if (email._activeSnapshot) {
    return {
      allowed: true,
      scope: "activeSnapshot",
      uid,
      itemId: email.snapshot_item_id ? String(email.snapshot_item_id) : null,
      restoreSelectedId,
      refreshAfterCommit: true,
    };
  }

  return {
    allowed: true,
    scope: "briefing",
    id,
    uid,
    restoreSelectedId,
    refreshAfterCommit: false,
  };
}

export function applyLiveTrashOptimistic(previous: ReadonlySet<string>, uid: string, trashed: boolean): Set<string> {
  const next = new Set(previous);
  if (trashed) next.add(uid);
  else next.delete(uid);
  return next;
}

export function applySnapshotTrashOptimistic(
  previous: ReadonlyMap<string, SnapshotOptimisticOverlay>,
  itemId: string | null | undefined,
  hidden: boolean,
): ReadonlyMap<string, SnapshotOptimisticOverlay> {
  if (!itemId) return previous;
  const next = new Map(previous);
  if (hidden) {
    next.set(itemId, {
      ...(previous.get(itemId) || {}),
      hidden: true,
      pendingAction: "trash",
      pending: false,
    });
  } else {
    next.delete(itemId);
  }
  return next;
}

export function canSnoozeUntil(timestamp: unknown, now = Date.now()): timestamp is number {
  return typeof timestamp === "number"
    && Number.isFinite(timestamp)
    && timestamp > now;
}

export function shouldHandleInboxUndoHotkey({
  key,
  metaKey = false,
  ctrlKey = false,
  hasUndoSlot = false,
  editableTarget = false,
}: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  hasUndoSlot?: boolean;
  editableTarget?: boolean;
}): boolean {
  return !!hasUndoSlot
    && !editableTarget
    && (metaKey || ctrlKey)
    && String(key || "").toLowerCase() === "z";
}
