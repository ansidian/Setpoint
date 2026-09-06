import {
  canDismissSnapshotEmail,
  canHandleSnapshotEmail,
  canMoveSnapshotEmailToLane,
  canReopenSnapshotEmail,
  hasActiveSnapshotItem,
} from "../activeSnapshotWorkflowModel";
import { isCatchUpEmail } from "../helpers";
import type { InboxEmailLike } from "../inboxTypes";

// Single source of truth for which actions a reader pane (desktop + mobile) shows
// for an email. Snapshot lifecycle decisions delegate to activeSnapshotWorkflowModel
// — the same predicates the keyboard hotkeys (resolveSnapshotHotkeyAction) and the
// action dispatch (useInboxActionDispatch) use — so a reader button can never offer
// an action the shortcut/dispatch would refuse.
//
// In particular every snapshot action requires hasActiveSnapshotItem (an active
// snapshot AND a snapshot_item_id). The readers previously gated on `_activeSnapshot`
// alone, so a snapshot row missing its snapshot_item_id surfaced Handled/Dismiss/Move
// buttons that silently no-opped on click (the dispatch early-returns without an id).
export function resolveReaderActions(
  email: InboxEmailLike | null | undefined,
  { readOnly = false }: { readOnly?: boolean } = {},
) {
  const catchUp = isCatchUpEmail(email);
  const isQueuedSnapshot = email?._lane === "queued";
  const isUntriagedReadSnapshot = email?._lane === "untriaged_read";

  const showMutableActions = !readOnly && !email?._snoozedUnavailable;
  const showDestructiveActions = showMutableActions && !catchUp && !email?._snoozed;
  // Actual records belong to the source email, independently of its triage or
  // snapshot lifecycle. The workspace resolves ownership before allowing edits.
  const canOpenActualRecord = !!email;

  // Eligible for the full triage workflow (move/handle), used to size the mobile
  // actions menu. Dismiss-only rows (e.g. queued) are intentionally excluded, matching
  // the prior showSnapshotWorkflowActions heuristic.
  const showSnapshotWorkflowActions = hasActiveSnapshotItem(email)
    && !readOnly
    && !catchUp
    && !isQueuedSnapshot
    && !isUntriagedReadSnapshot;

  // Catch-up rows never expose snapshot lifecycle actions, mirroring the hotkey
  // resolver's isCatchUpEmail short-circuit.
  const snapshotEligible = !catchUp;

  return {
    catchUp,
    isQueuedSnapshot,
    isUntriagedReadSnapshot,
    showMutableActions,
    showDestructiveActions,
    canOpenActualRecord,
    showSnapshotWorkflowActions,
    canReopen: snapshotEligible && canReopenSnapshotEmail(email, readOnly),
    canHandle: snapshotEligible && canHandleSnapshotEmail(email, readOnly),
    canDismiss: snapshotEligible && canDismissSnapshotEmail(email, readOnly),
    canMoveToNeeds: snapshotEligible && canMoveSnapshotEmailToLane(email, "needs_attention", readOnly),
    canMoveToFyi: snapshotEligible && canMoveSnapshotEmailToLane(email, "fyi", readOnly),
    canMoveToNoise: snapshotEligible && canMoveSnapshotEmailToLane(email, "noise", readOnly),
    // Pin is an overlay write, deliberately exempt from readOnly and catch-up
    // gating — pinning from frozen-snapshot browsing is the feature.
    canPin: !!email && !email._snoozedUnavailable,
    pinned: !!email?._pinned,
  };
}

export type ReaderMoveDestination = {
  lane: "needs_attention" | "fyi" | "noise";
  label: string;
  keyHint: "A" | "F" | "N";
};

export type ReaderTriageItem = {
  key: "snapshot-reopen" | "snapshot-handled" | "snapshot-dismiss" | "snooze" | "pin-toggle" | "toggle-read" | "unsnooze";
  label: string;
  keyHint: "H" | "D" | "S" | "P" | null;
  section: "lifecycle" | "state";
  disabled: boolean;
  active: boolean;
};

export function resolveReaderActionGroups(
  email: InboxEmailLike,
  options: { readOnly?: boolean } = {},
) {
  const actions = resolveReaderActions(email, options);
  const snapshotPending = !!email._optimisticSnapshotPending;
  const moveDestinations: ReaderMoveDestination[] = [];
  const triageItems: ReaderTriageItem[] = [];

  if (actions.canMoveToNeeds) {
    moveDestinations.push({ lane: "needs_attention", label: "Needs Attention", keyHint: "A" });
  }
  if (actions.canMoveToFyi) {
    moveDestinations.push({ lane: "fyi", label: "FYI", keyHint: "F" });
  }
  if (actions.canMoveToNoise) {
    moveDestinations.push({ lane: "noise", label: "Noise", keyHint: "N" });
  }

  if (email._snoozed) {
    triageItems.push({
      key: "unsnooze", label: email._snoozedReturning ? "Returning…" : "Return to Inbox",
      keyHint: null, section: "lifecycle", disabled: !!email._snoozedUnavailable || !!email._snoozedReturning, active: false,
    });
  }
  if (actions.canReopen) {
    triageItems.push({
      key: "snapshot-reopen",
      label: "Reopen",
      keyHint: "H",
      section: "lifecycle",
      disabled: snapshotPending,
      active: false,
    });
  } else if (actions.canHandle) {
    triageItems.push({
      key: "snapshot-handled",
      label: "Mark handled",
      keyHint: "H",
      section: "lifecycle",
      disabled: snapshotPending,
      active: false,
    });
  }
  if (actions.canDismiss) {
    triageItems.push({
      key: "snapshot-dismiss",
      label: "Dismiss from today",
      keyHint: "D",
      section: "lifecycle",
      disabled: snapshotPending,
      active: false,
    });
  }
  if (actions.showDestructiveActions) {
    triageItems.push({
      key: "snooze",
      label: "Snooze…",
      keyHint: "S",
      section: "lifecycle",
      disabled: false,
      active: false,
    });
  }
  if (actions.canPin) {
    triageItems.push({
      key: "pin-toggle",
      label: actions.pinned ? "Unpin" : "Pin",
      keyHint: "P",
      section: "state",
      disabled: false,
      active: actions.pinned,
    });
  }
  if (actions.showMutableActions) {
    triageItems.push({
      key: "toggle-read",
      label: email.read ? "Mark unread" : "Mark read",
      keyHint: null,
      section: "state",
      disabled: false,
      active: false,
    });
  }

  return {
    ...actions,
    moveDestinations,
    moveDisabled: snapshotPending,
    triageItems,
  };
}
