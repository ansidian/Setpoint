import { isCatchUpEmail } from "./helpers.js";

export function buildTrashCommand(email, { readOnly = false } = {}) {
  if (!email || readOnly || isCatchUpEmail(email)) {
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

export function applyLiveTrashOptimistic(previous, uid, trashed) {
  const next = new Set(previous);
  if (trashed) next.add(uid);
  else next.delete(uid);
  return next;
}

export function applySnapshotTrashOptimistic(previous, itemId, hidden) {
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

export function shouldHandleInboxUndoHotkey({
  key,
  metaKey = false,
  ctrlKey = false,
  hasUndoSlot = false,
  editableTarget = false,
}) {
  return !!hasUndoSlot
    && !editableTarget
    && (metaKey || ctrlKey)
    && String(key || "").toLowerCase() === "z";
}
