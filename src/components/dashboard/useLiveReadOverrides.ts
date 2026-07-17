import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collectActiveReadOverrideKeys,
  computeInboxUnreadSignalCount,
} from "./inboxBadgeModel";
import type { CurrentDashboardHookResult } from "../../hooks/useCurrentDashboard";
import type { CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";
import type { ActiveSnapshotView } from "../../../shared/types/snapshots";

export interface DashboardActiveSnapshotController {
  snapshot: ActiveSnapshotView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<unknown>;
  sync: () => Promise<unknown>;
}

// Owns the live read-override map (per-email read flags applied on top of the
// active snapshot/live feed) and the derived inbox unread-signal count shown on
// the shell header badge. The prune effect drops overrides whose emails left the
// active snapshot, and the count math lives in the pure inboxBadgeModel.
export default function useLiveReadOverrides({ activeSnapshot, liveData }: { activeSnapshot: DashboardActiveSnapshotController; liveData: CurrentDashboardLiveData }) {
  const [liveReadOverrides, setLiveReadOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const activeUids = collectActiveReadOverrideKeys({
      activeSnapshotView: activeSnapshot?.snapshot,
      liveEmails: liveData.liveEmails,
      resurfacedEntries: liveData.resurfacedEntries,
    });
    // Pre-existing: prune read-overrides whose emails left the active snapshot.
    // The functional setState only commits when something actually changed (it
    // returns prev otherwise), so no cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveReadOverrides((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [uid, read] of Object.entries(prev)) {
        if (activeUids.has(uid)) next[uid] = read;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [activeSnapshot?.snapshot, liveData.liveEmails, liveData.resurfacedEntries]);

  const handleLiveReadOverrideChange = useCallback((uid: string, read: boolean) => {
    if (!uid) return;
    setLiveReadOverrides((prev) => {
      if (prev[uid] === read) return prev;
      return { ...prev, [uid]: !!read };
    });
  }, []);

  const inboxUnreadSignalCount = useMemo(() => {
    return computeInboxUnreadSignalCount({
      activeSnapshot: activeSnapshot?.snapshot,
      liveEmails: liveData.liveEmails,
      resurfacedEntries: liveData.resurfacedEntries,
      liveReadOverrides,
    });
  }, [activeSnapshot?.snapshot, liveData.liveEmails, liveData.resurfacedEntries, liveReadOverrides]);

  return { liveReadOverrides, handleLiveReadOverrideChange, inboxUnreadSignalCount };
}
