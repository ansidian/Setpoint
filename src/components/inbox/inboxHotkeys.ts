import { resolveSnapshotHotkeyAction } from "./activeSnapshotWorkflowModel";
import type { SnapshotHotkeyAction } from "./activeSnapshotWorkflowModel";
import type { InboxEmailLike } from "./inboxTypes";

export type InboxHotkeyAction = SnapshotHotkeyAction
  | { kind: "pin-toggle" }
  | { kind: "snooze-default" }
  | { kind: "trash" };

export function shouldSuspendInboxHotkeys(target: EventTarget | null): boolean {
  if (isEditableKeyTarget(target)) return true;
  const element = target instanceof Element ? target : null;
  if (element?.closest("[data-suspend-inbox-hotkeys='true']")) return true;
  if (element?.closest('[role="menu"], [role="dialog"], [role="listbox"]')) return true;
  const active = document.activeElement;
  return !!(active && active !== document.body
    && active.closest?.('[role="menu"], [role="dialog"], [role="listbox"]'));
}

export function resolveInboxHotkeyAction(
  key: string,
  selectedEmail: InboxEmailLike | null | undefined,
  readOnly: boolean,
): InboxHotkeyAction | null {
  const snapshotAction = resolveSnapshotHotkeyAction(key, selectedEmail, readOnly);
  if (snapshotAction) return snapshotAction;
  // Pin is an overlay write, not a snapshot mutation: allowed on read-only
  // (frozen) views and catch-up rows — pinning history is the feature.
  if (key === "p" && selectedEmail) return { kind: "pin-toggle" };
  if (isCatchUpEmail(selectedEmail)) return null;
  if (key === "s" && selectedEmail && !readOnly) return { kind: "snooze-default" };
  if (key === "e" && selectedEmail && !readOnly) return { kind: "trash" };
  return null;
}

function isCatchUpEmail(email: InboxEmailLike | null | undefined): boolean {
  return email?._lane === "catch_up" || email?._catchUp || email?.source === "catch_up";
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  if (!(target instanceof Element)) return false;
  const tagName = target.tagName;
  return tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
    || (target instanceof HTMLElement && target.isContentEditable);
}
