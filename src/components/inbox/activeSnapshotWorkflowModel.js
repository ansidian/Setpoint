export const SNAPSHOT_LANE_ORDER = {
  queued: 0,
  carryover: 1,
  needs_attention: 2,
  action: 2,
  catch_up: 3,
  fyi: 4,
  handled: 5,
  untriaged_read: 6,
  noise: 7,
};

const SNAPSHOT_REOPEN_LANES = new Set(["needs_attention", "fyi", "noise"]);
const SNAPSHOT_MUTABLE_LANES = new Set(["needs_attention", "carryover", "fyi", "noise", "handled"]);
const SNAPSHOT_DISMISSIBLE_LANES = new Set(["queued", "needs_attention", "carryover", "fyi", "noise"]);

function isCatchUpEmail(email) {
  return email?._lane === "catch_up" || email?._catchUp || email?.source === "catch_up";
}

export function snapshotInboxLaneForItem(item = {}) {
  const resurfaced = item.source === "resurfaced_snooze" || item._resurfaced;
  const pendingSecurityGrace = item.source === "pending_security_grace";
  const arrivalGraceQueued = item.lane === "queued" || item.source === "arrival_grace";
  const untriagedRead = item.lane === "untriaged_read" || item.source === "arrival_grace_read";
  const catchUp = item._snapshotCatchUp || item.lane === "catch_up" || item.source === "catch_up";

  if (item.handled_at) return "handled";
  if (resurfaced || pendingSecurityGrace) return null;
  if (arrivalGraceQueued) return "queued";
  if (untriagedRead) return "untriaged_read";
  if (catchUp) return "catch_up";
  if (item._snapshotCarryover) return "carryover";
  return item.lane === "action" ? "needs_attention" : item.lane;
}

export function getSnapshotReopenLane(email) {
  const lane = email?._lane === "carryover"
    ? "needs_attention"
    : email?.lane || email?.lane_at_snapshot || email?._lane;
  return SNAPSHOT_REOPEN_LANES.has(lane) ? lane : "needs_attention";
}

export function isSnapshotWorkflowLane(email) {
  return SNAPSHOT_MUTABLE_LANES.has(email?._lane);
}

export function isSnapshotDismissibleLane(email) {
  return SNAPSHOT_DISMISSIBLE_LANES.has(email?._lane);
}

export function hasActiveSnapshotItem(email) {
  return !!email?._activeSnapshot && !!email.snapshot_item_id;
}

export function canHandleSnapshotEmail(email, readOnly) {
  if (readOnly || !hasActiveSnapshotItem(email)) return false;
  if (email._lane === "queued" || email._lane === "untriaged_read") return false;
  const lane = email._lane === "carryover" ? "needs_attention" : email._lane;
  return lane === "needs_attention" || lane === "fyi";
}

export function canReopenSnapshotEmail(email, readOnly) {
  return !readOnly && hasActiveSnapshotItem(email) && email._lane === "handled";
}

export function canDismissSnapshotEmail(email, readOnly) {
  return !readOnly
    && hasActiveSnapshotItem(email)
    && email._lane !== "handled"
    && email._lane !== "untriaged_read";
}

export function canMoveSnapshotEmailToLane(email, targetLane, readOnly) {
  if (readOnly || !hasActiveSnapshotItem(email)) return false;
  if (email._lane === "handled" || email._lane === "queued" || email._lane === "untriaged_read" || email._untriaged) {
    return false;
  }
  const currentLane = email._lane === "carryover" ? "needs_attention" : email._lane;
  return currentLane !== targetLane;
}

export function resolveSnapshotHotkeyAction(key, selectedEmail, readOnly) {
  if (isCatchUpEmail(selectedEmail)) return null;
  if (key === "h" && canHandleSnapshotEmail(selectedEmail, readOnly)) {
    return { kind: "snapshot-handled" };
  }
  if (key === "h" && canReopenSnapshotEmail(selectedEmail, readOnly)) {
    return { kind: "snapshot-reopen" };
  }
  if (key === "d" && canDismissSnapshotEmail(selectedEmail, readOnly)) {
    return { kind: "snapshot-dismiss" };
  }
  if (key === "f" && canMoveSnapshotEmailToLane(selectedEmail, "fyi", readOnly)) {
    return { kind: "snapshot-move-lane", lane: "fyi" };
  }
  if (key === "n" && canMoveSnapshotEmailToLane(selectedEmail, "noise", readOnly)) {
    return { kind: "snapshot-move-lane", lane: "noise" };
  }
  if (key === "a" && canMoveSnapshotEmailToLane(selectedEmail, "needs_attention", readOnly)) {
    return { kind: "snapshot-move-lane", lane: "needs_attention" };
  }
  return null;
}
