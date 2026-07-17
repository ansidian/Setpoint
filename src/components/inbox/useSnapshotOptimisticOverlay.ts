import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { InboxEmailLike, SnapshotOptimisticOverlay } from "./inboxTypes";

type SnapshotOverlayMap = Map<string, SnapshotOptimisticOverlay>;

export interface SnapshotOptimisticOverlayController {
  optimisticActiveSnapshotEmails: InboxEmailLike[];
  setSnapshotOptimistic: Dispatch<SetStateAction<SnapshotOverlayMap>>;
  snapshotPendingRef: MutableRefObject<Set<string>>;
  snapshotRequestRef: MutableRefObject<number>;
}

// Decides which optimistic overlays survive a server snapshot refresh:
// pending overlays always survive, failed ones drop, lane overrides drop once
// the server row reflects the lane, hidden/handled overrides persist until
// their row disappears from the refreshed snapshot. Mutates `pendingSet` to
// release rows whose overlay is dropped. Returns `prev` unchanged when no
// overlay was released, so React can skip the state update.
export function reconcileSnapshotOverlays(
  prev: SnapshotOverlayMap,
  rowsByItemId: ReadonlyMap<string, InboxEmailLike>,
  pendingSet: Set<string>,
): SnapshotOverlayMap {
  let changed = false;
  const next: SnapshotOverlayMap = new Map();

  for (const [itemId, overlay] of prev.entries()) {
    const row = rowsByItemId.get(itemId);
    if (!row) {
      pendingSet.delete(itemId);
      changed = true;
      continue;
    }
    if (overlay.pending) {
      next.set(itemId, overlay);
      continue;
    }
    if (overlay.failed) {
      pendingSet.delete(itemId);
      changed = true;
      continue;
    }
    if (overlay.laneOverride && row._lane === overlay.laneOverride) {
      pendingSet.delete(itemId);
      changed = true;
      continue;
    }
    if (overlay.hidden || overlay.statusOverride) {
      next.set(itemId, overlay);
      continue;
    }
    next.set(itemId, overlay);
  }

  return changed ? next : prev;
}

// Projects the overlay Map onto the raw snapshot rows: hidden rows drop out,
// lane/handled overrides replace the server values, and the pending flags are
// exposed for row-level affordances.
export function applySnapshotOverlays(
  emails: InboxEmailLike[],
  overlays: ReadonlyMap<string, SnapshotOptimisticOverlay>,
): InboxEmailLike[] {
  const out: InboxEmailLike[] = [];

  for (const email of emails) {
    const itemId = String(email.snapshot_item_id);
    const overlay = overlays.get(itemId);
    if (!overlay) {
      out.push(email);
      continue;
    }
    if (overlay.hidden) continue;
    out.push({
      ...email,
      lane: overlay.laneOverride || email.lane,
      _lane: overlay.laneOverride || email._lane,
      handled_at: overlay.handledAt || email.handled_at,
      _optimisticSnapshotAction: overlay.pendingAction,
      _optimisticSnapshotPending: overlay.pending,
    });
  }

  return out;
}

// Owns the optimistic overlay Map for active-snapshot rows plus the
// pending/request bookkeeping the action dispatcher uses to dedupe in-flight
// mutations and reject stale settles. Extracted from useInboxController
// (EAD-327).
export default function useSnapshotOptimisticOverlay({
  activeSnapshotMode,
  rawActiveSnapshotEmails,
}: {
  activeSnapshotMode: boolean;
  rawActiveSnapshotEmails: InboxEmailLike[];
}): SnapshotOptimisticOverlayController {
  const [snapshotOptimistic, setSnapshotOptimistic] = useState<SnapshotOverlayMap>(() => new Map());
  const snapshotPendingRef = useRef<Set<string>>(new Set());
  const snapshotRequestRef = useRef(0);

  useEffect(() => {
    if (!activeSnapshotMode) {
      snapshotPendingRef.current.clear();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- drop overlays when leaving snapshot mode
      setSnapshotOptimistic((prev) => (prev.size > 0 ? new Map() : prev));
      return;
    }

    const rowsByItemId = new Map(rawActiveSnapshotEmails.map((email) => [
      String(email.snapshot_item_id),
      email,
    ]));

    setSnapshotOptimistic((prev) => (
      reconcileSnapshotOverlays(prev, rowsByItemId, snapshotPendingRef.current)
    ));
  }, [activeSnapshotMode, rawActiveSnapshotEmails]);

  const optimisticActiveSnapshotEmails = useMemo(() => {
    if (!activeSnapshotMode || snapshotOptimistic.size === 0) return rawActiveSnapshotEmails;
    return applySnapshotOverlays(rawActiveSnapshotEmails, snapshotOptimistic);
  }, [activeSnapshotMode, rawActiveSnapshotEmails, snapshotOptimistic]);

  return {
    optimisticActiveSnapshotEmails,
    setSnapshotOptimistic,
    snapshotPendingRef,
    snapshotRequestRef,
  };
}
