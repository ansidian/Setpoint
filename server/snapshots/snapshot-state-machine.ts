/**
 * Snapshot lane state machine (D-INBOX-4).
 *
 * The 8 inbox lanes are `queued, needs_attention, catch_up, fyi, handled,
 * untriaged_read, noise, carryover`, but only five are stored values of
 * `ea_briefing_snapshot_items.lane_at_snapshot`:
 * `queued, untriaged_read, needs_attention, fyi, noise`. The other three are
 * derived at read time:
 *
 * - `handled`   — `handled_at IS NOT NULL`; `lane_at_snapshot` is preserved so
 *                 reopen can restore it (see `getSnapshotReopenLane`).
 * - `carryover` — `is_carryover = 1`; copied from the previous frozen snapshot
 *                 at boundary advance (`copyCarryoverItems`).
 * - `catch_up`  — virtual; previous snapshot's still-unread `fyi` items
 *                 surfaced read-only into the active view (`loadActiveCatchUpItems`).
 *
 * Dismissal (`dismissed_from_today_at`) and provider removal
 * (`provider_removed_at`, states in `PROVIDER_REMOVED_STATES`) are orthogonal
 * visibility tombstones, not lanes: they hide an item from every lane without
 * changing `lane_at_snapshot`.
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> queued: new email indexed during arrival grace\n(attachArrivalGraceEmailToActiveSnapshot)
 *     [*] --> needs_attention: triage decision (triage-worker)\nor snooze resurface (resurfacedTriageLane)
 *     [*] --> fyi: triage decision / snooze resurface
 *     [*] --> noise: triage decision / snooze resurface
 *
 *     queued --> untriaged_read: read during arrival grace\n(settleReadArrivalGraceRows)
 *     queued --> needs_attention: arrival-grace triage completes
 *     queued --> fyi: arrival-grace triage completes
 *     queued --> noise: arrival-grace triage completes
 *
 *     needs_attention --> fyi: moveSnapshotItemLane (user)
 *     needs_attention --> noise: moveSnapshotItemLane (user)
 *     fyi --> needs_attention: moveSnapshotItemLane (user)
 *     fyi --> noise: moveSnapshotItemLane (user)
 *     noise --> needs_attention: moveSnapshotItemLane (user)
 *     noise --> fyi: moveSnapshotItemLane (user)
 *
 *     needs_attention --> handled: markSnapshotItemHandled\n(sets handled_at, lane preserved)
 *     fyi --> handled: markSnapshotItemHandled
 *     noise --> handled: markSnapshotItemHandled
 *     carryover --> handled: markSnapshotItemHandled
 *     handled --> needs_attention: reopenSnapshotItem\n(getSnapshotReopenLane fallback)
 *     handled --> fyi: reopenSnapshotItem (lane preserved)
 *     handled --> noise: reopenSnapshotItem (lane preserved)
 *
 *     needs_attention --> carryover: boundary advance, still needs_attention\n(copyCarryoverItems, is_carryover=1)
 *     queued --> queued: boundary advance, still pending arrival grace\n(copyCarryoverItems keeps queued)
 *     fyi --> catch_up: boundary advance, still unread\n(loadActiveCatchUpItems, virtual)
 * ```
 *
 * The frontend mirror of these rules lives in
 * `src/components/inbox/activeSnapshotWorkflowModel.js` (display-lane
 * projection and hotkey/action guards for optimistic UI).
 */

import {
  ARRIVAL_GRACE_QUEUED_LANE,
  ARRIVAL_GRACE_UNTRIAGED_READ_LANE,
} from "./arrival-grace.ts";
import {
  SNAPSHOT_LANES as SHARED_SNAPSHOT_LANES,
  type SnapshotProviderRemovedState,
  type SnapshotTriageLane,
} from "../../shared/types/snapshots.ts";

export const SNAPSHOT_LANES = SHARED_SNAPSHOT_LANES;

// Lanes a triage decision or user lane-move may assign.
export const TRIAGE_LANES: ReadonlySet<string> = new Set<SnapshotTriageLane>(["needs_attention", "fyi", "noise"]);

// Stored lane_at_snapshot values counted in the snapshot history view.
export const SNAPSHOT_DISPLAY_LANES: ReadonlySet<string> = new Set([
  ARRIVAL_GRACE_QUEUED_LANE,
  "needs_attention",
  "fyi",
  "handled",
  ARRIVAL_GRACE_UNTRIAGED_READ_LANE,
  "noise",
]);

// Provider states that tombstone an item out of active snapshots.
export const PROVIDER_REMOVED_STATES: ReadonlySet<string> = new Set<SnapshotProviderRemovedState>(["archived", "trashed"]);

// Reopening a handled item restores its pre-handled lane when that lane is
// user-assignable; anything else (queued, untriaged_read, legacy values)
// lands in needs_attention so the owner sees it again.
export function getSnapshotReopenLane(laneAtSnapshot: unknown): SnapshotTriageLane {
  return TRIAGE_LANES.has(String(laneAtSnapshot)) ? laneAtSnapshot as SnapshotTriageLane : "needs_attention";
}

// A snoozed email resurfaces into its remembered lane only if that lane is
// user-assignable; unknown or non-triage lanes fall back to needs_attention.
export function resurfacedTriageLane(snapshot: Record<string, unknown> | null | undefined): SnapshotTriageLane {
  const lane = snapshot?._lane || snapshot?.lane || "needs_attention";
  return TRIAGE_LANES.has(String(lane)) ? lane as SnapshotTriageLane : "needs_attention";
}

// Items whose triage has not settled yet; dismissing one must also skip the
// pending triage so the worker does not resurrect the row.
export function isPendingSnapshotTriage(item: Record<string, unknown> | null | undefined): boolean {
  return item?.triage_status === "pending"
    || item?.triage_source === "weak_security_grace"
    || item?.source === "pending_security_grace";
}
