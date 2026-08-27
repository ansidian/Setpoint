import { useCallback, useEffect, useRef, useState } from "react";
import { getSnapshotById, getSnapshotHistory } from "../../api";
import type {
  SnapshotHistoryEntry,
  SnapshotRecord,
  SnapshotView,
} from "../../../shared/types/snapshots";
import {
  resolveAdjacentSnapshot,
  type SnapshotNavigationDirection,
} from "./snapshotNavigationModel";

interface UseSnapshotNavigationOptions {
  enabled: boolean;
  activeSnapshotId: number | null;
  currentSnapshot: SnapshotRecord | null;
  onSelectSnapshot: (view: SnapshotView | null, meta: { readOnly: boolean }) => void;
}

export default function useSnapshotNavigation({
  enabled,
  activeSnapshotId,
  currentSnapshot,
  onSelectSnapshot,
}: UseSnapshotNavigationOptions) {
  const [history, setHistory] = useState<SnapshotHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [navigating, setNavigating] = useState<SnapshotNavigationDirection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigationRequestRef = useRef(0);

  useEffect(() => {
    if (!enabled || activeSnapshotId == null) return undefined;
    let cancelled = false;
    setHistoryLoading(true);
    setError(null);
    getSnapshotHistory()
      .then((response) => {
        if (cancelled) return;
        setHistory(response?.snapshots || []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load snapshot history");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSnapshotId, enabled]);

  const currentId = currentSnapshot?.id ?? null;
  const older = resolveAdjacentSnapshot(history, currentId, "older");
  const newer = resolveAdjacentSnapshot(history, currentId, "newer");

  const onNavigate = useCallback(async (direction: SnapshotNavigationDirection) => {
    if (navigating) return;
    const target = resolveAdjacentSnapshot(history, currentId, direction);
    if (!target) return;

    const requestId = navigationRequestRef.current + 1;
    navigationRequestRef.current = requestId;
    setNavigating(direction);
    setError(null);
    try {
      const view = target.readOnly ? await getSnapshotById(target.id) : null;
      if (navigationRequestRef.current !== requestId) return;
      onSelectSnapshot(view, { readOnly: target.readOnly });
    } catch (err: unknown) {
      if (navigationRequestRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Failed to load snapshot");
    } finally {
      if (navigationRequestRef.current === requestId) setNavigating(null);
    }
  }, [currentId, history, navigating, onSelectSnapshot]);

  return {
    snapshot: currentSnapshot,
    canOlder: !!older,
    canNewer: !!newer,
    newerIsCurrent: !!newer && !newer.readOnly,
    historyLoading,
    navigating,
    error,
    onNavigate,
  };
}
