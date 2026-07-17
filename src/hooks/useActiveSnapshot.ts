import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveSnapshot, syncActiveSnapshot } from "../api";
import type { ActiveSnapshotView } from "../../shared/types/snapshots";

const PROCESSING_POLL_MS = 15_000;

export interface ActiveSnapshotHookOptions {
  disabled?: boolean;
}

export interface ActiveSnapshotHookResult {
  snapshot: ActiveSnapshotView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ActiveSnapshotView | null>;
  sync: () => Promise<ActiveSnapshotView | null>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function useActiveSnapshot({ disabled = false }: ActiveSnapshotHookOptions = {}): ActiveSnapshotHookResult {
  const [snapshot, setSnapshot] = useState<ActiveSnapshotView | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (disabled) return null;
    setLoading(true);
    try {
      const data = await getActiveSnapshot();
      if (!mountedRef.current) return data;
      setSnapshot(data);
      setError(null);
      return data;
    } catch (err: unknown) {
      if (mountedRef.current) setError(errorMessage(err, "Failed to load active snapshot."));
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [disabled]);

  const sync = useCallback(async () => {
    if (disabled) return null;
    setLoading(true);
    try {
      const data = await syncActiveSnapshot();
      if (!mountedRef.current) return data;
      setSnapshot(data);
      setError(null);
      return data;
    } catch (err: unknown) {
      if (mountedRef.current) setError(errorMessage(err, "Failed to sync active snapshot."));
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [disabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (disabled) {
      setSnapshot(null);
      setLoading(false);
      return undefined;
    }
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [disabled, refresh]);

  useEffect(() => {
    if (disabled || !snapshot?.processing?.active) return undefined;
    const id = setInterval(refresh, PROCESSING_POLL_MS);
    return () => clearInterval(id);
  }, [disabled, refresh, snapshot?.processing?.active]);

  return {
    snapshot,
    loading,
    error,
    refresh,
    sync,
  };
}
