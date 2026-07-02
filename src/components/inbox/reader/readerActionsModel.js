import {
  canDismissSnapshotEmail,
  canHandleSnapshotEmail,
  canMoveSnapshotEmailToLane,
  canReopenSnapshotEmail,
  hasActiveSnapshotItem,
} from "../activeSnapshotWorkflowModel.js";
import { isCatchUpEmail } from "../helpers";

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
export function resolveReaderActions(email, { readOnly = false } = {}) {
  const catchUp = isCatchUpEmail(email);
  const isQueuedSnapshot = email?._lane === "queued";
  const isUntriagedReadSnapshot = email?._lane === "untriaged_read";

  const showMutableActions = !readOnly;
  const showDestructiveActions = showMutableActions && !catchUp;
  const billToggleEligible = !!(
    email?._untriaged || email?.hasBill || isQueuedSnapshot || isUntriagedReadSnapshot
  );

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
    billToggleEligible,
    showSnapshotWorkflowActions,
    canReopen: snapshotEligible && canReopenSnapshotEmail(email, readOnly),
    canHandle: snapshotEligible && canHandleSnapshotEmail(email, readOnly),
    canDismiss: snapshotEligible && canDismissSnapshotEmail(email, readOnly),
    canMoveToNeeds: snapshotEligible && canMoveSnapshotEmailToLane(email, "needs_attention", readOnly),
    canMoveToFyi: snapshotEligible && canMoveSnapshotEmailToLane(email, "fyi", readOnly),
    canMoveToNoise: snapshotEligible && canMoveSnapshotEmailToLane(email, "noise", readOnly),
    // Pin is an overlay write, deliberately exempt from readOnly and catch-up
    // gating — pinning from frozen-snapshot browsing is the feature.
    canPin: !!email,
    pinned: !!email?._pinned,
  };
}
