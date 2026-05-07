export function shouldSuspendInboxHotkeys(target) {
  if (isEditableKeyTarget(target)) return true;
  if (target?.closest?.("[data-suspend-inbox-hotkeys='true']")) return true;
  if (target?.closest?.('[role="menu"], [role="dialog"], [role="listbox"]')) return true;
  return !!document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]');
}

export function resolveInboxHotkeyAction(key, selectedEmail, readOnly) {
  if (isCatchUpEmail(selectedEmail)) return null;
  if (key === "h" && canHandleSelectedEmail(selectedEmail, readOnly)) {
    return { kind: "snapshot-handled" };
  }
  if (key === "h" && canReopenSelectedEmail(selectedEmail, readOnly)) {
    return { kind: "snapshot-reopen" };
  }
  if (key === "s" && selectedEmail && !readOnly) return { kind: "snooze-default" };
  if (key === "e" && selectedEmail && !readOnly) return { kind: "trash" };
  if (key === "d" && canDismissSelectedEmail(selectedEmail, readOnly)) {
    return { kind: "snapshot-dismiss" };
  }
  if (key === "f" && canMoveSelectedEmailToLane(selectedEmail, "fyi", readOnly)) {
    return { kind: "snapshot-move-lane", lane: "fyi" };
  }
  if (key === "n" && canMoveSelectedEmailToLane(selectedEmail, "noise", readOnly)) {
    return { kind: "snapshot-move-lane", lane: "noise" };
  }
  if (key === "a" && canMoveSelectedEmailToLane(selectedEmail, "needs_attention", readOnly)) {
    return { kind: "snapshot-move-lane", lane: "needs_attention" };
  }
  return null;
}

function isCatchUpEmail(email) {
  return email?._lane === "catch_up" || email?._catchUp || email?.source === "catch_up";
}

function isEditableKeyTarget(target) {
  if (!target) return false;
  const tagName = target.tagName;
  return tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
    || target.isContentEditable;
}

function canHandleSelectedEmail(email, readOnly) {
  if (readOnly || !email?._activeSnapshot || !email.snapshot_item_id) return false;
  const lane = email._lane === "carryover" ? "needs_attention" : email._lane;
  return lane === "needs_attention" || lane === "fyi";
}

function canReopenSelectedEmail(email, readOnly) {
  return !readOnly && !!email?._activeSnapshot && !!email.snapshot_item_id && email._lane === "handled";
}

function canDismissSelectedEmail(email, readOnly) {
  return !readOnly && !!email?._activeSnapshot && !!email.snapshot_item_id && email._lane !== "handled";
}

function canMoveSelectedEmailToLane(email, targetLane, readOnly) {
  if (readOnly || !email?._activeSnapshot || !email.snapshot_item_id) return false;
  if (email._lane === "handled" || email._untriaged) return false;
  const currentLane = email._lane === "carryover" ? "needs_attention" : email._lane;
  return currentLane !== targetLane;
}
