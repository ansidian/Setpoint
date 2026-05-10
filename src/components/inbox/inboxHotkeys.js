import { resolveSnapshotHotkeyAction } from "./activeSnapshotWorkflowModel.js";

export function shouldSuspendInboxHotkeys(target) {
  if (isEditableKeyTarget(target)) return true;
  if (target?.closest?.("[data-suspend-inbox-hotkeys='true']")) return true;
  if (target?.closest?.('[role="menu"], [role="dialog"], [role="listbox"]')) return true;
  return !!document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]');
}

export function resolveInboxHotkeyAction(key, selectedEmail, readOnly) {
  const snapshotAction = resolveSnapshotHotkeyAction(key, selectedEmail, readOnly);
  if (snapshotAction) return snapshotAction;
  if (isCatchUpEmail(selectedEmail)) return null;
  if (key === "s" && selectedEmail && !readOnly) return { kind: "snooze-default" };
  if (key === "e" && selectedEmail && !readOnly) return { kind: "trash" };
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
