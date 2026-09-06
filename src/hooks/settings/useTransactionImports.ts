import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commitTransactionImportItems,
  dismissTransactionImportItem,
  getTransactionImportRun,
  getDashboardFinanceReviewRuns,
  listTransactionImportRuns,
  retryTransactionImportItem,
  startTransactionImportScan,
} from "@/api";
import type {
  TransactionImportConfirmation,
  TransactionImportHistoricalScanRequest,
  TransactionImportRunDetail,
  TransactionImportRunSummary,
} from "../../../shared/types/transaction-imports";

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "retry"]);
const ACTIVE_ITEM_STATUSES = new Set(["queued", "reconciling", "importing"]);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Transaction imports are temporarily unavailable.";
}

export function isTransactionImportWorkActive(
  runs: TransactionImportRunSummary[],
  detail: TransactionImportRunDetail | null,
): boolean {
  return runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))
    || Boolean(detail?.items.some((item) => ACTIVE_ITEM_STATUSES.has(item.status)));
}

export default function useTransactionImports({ enabled = true, requestedRunId = null, pendingOnly = false }: { enabled?: boolean; requestedRunId?: string | null; pendingOnly?: boolean } = {}) {
  const [runs, setRuns] = useState<TransactionImportRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<TransactionImportRunDetail | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pageOffset, setPageOffset] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const pageOffsetRef = useRef(0);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const selectedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  const loadRun = useCallback(async (runId: string | null, requestId = requestRef.current) => {
    if (!runId) {
      if (mountedRef.current && requestId === requestRef.current) setSelectedRun(null);
      return null;
    }
    const detail = await getTransactionImportRun(runId);
    if (mountedRef.current && requestId === requestRef.current) setSelectedRun(detail);
    return detail;
  }, []);

  const refresh = useCallback(async ({ quiet = false, offset = pageOffsetRef.current }: { quiet?: boolean; offset?: number } = {}) => {
    if (!enabled) return;
    const requestId = ++requestRef.current;
    if (!quiet) setLoading(true);
    try {
      let response = pendingOnly ? await getDashboardFinanceReviewRuns(offset)
        : await listTransactionImportRuns().then(({ runs }) => ({ runs, total: runs.length, offset: 0 }));
      if (pendingOnly && offset > 0 && offset >= response.total) {
        offset = Math.max(0, Math.floor((response.total - 1) / 12) * 12);
        response = await getDashboardFinanceReviewRuns(offset);
      }
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setRuns(response.runs);
      setTotalRuns(response.total);
      setPageOffset(offset);
      pageOffsetRef.current = offset;
      const currentId = selectedRunIdRef.current;
      const nextId = currentId && (currentId === requestedRunId || response.runs.some((run) => run.id === currentId))
        ? currentId
        : response.runs[0]?.id || null;
      setSelectedRunId(nextId);
      selectedRunIdRef.current = nextId;
      setSelectedRun((current) => current?.id === nextId ? current : null);
      await loadRun(nextId, requestId);
      if (mountedRef.current && requestId === requestRef.current) setError("");
    } catch (nextError) {
      if (mountedRef.current && requestId === requestRef.current) setError(errorText(nextError));
    } finally {
      if (mountedRef.current && requestId === requestRef.current) setLoading(false);
    }
  }, [enabled, loadRun, pendingOnly, requestedRunId]);

  useEffect(() => {
    mountedRef.current = true;
    selectedRunIdRef.current = requestedRunId;
    pageOffsetRef.current = 0;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh, requestedRunId]);

  const changePage = useCallback((offset: number) => {
    selectedRunIdRef.current = null;
    setSelectedRunId(null);
    setSelectedRun(null);
    return refresh({ offset: Math.max(0, offset) });
  }, [refresh]);

  const active = useMemo(() => isTransactionImportWorkActive(runs, selectedRun), [runs, selectedRun]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh({ quiet: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    if (!active) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh({ quiet: true });
    }, 3_000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, enabled, refresh]);

  const selectRun = useCallback(async (runId: string) => {
    const requestId = ++requestRef.current;
    selectedRunIdRef.current = runId;
    setSelectedRunId(runId);
    setSelectedRun(null);
    setLoading(true);
    try {
      await loadRun(runId, requestId);
      if (mountedRef.current && requestId === requestRef.current) setError("");
    } catch (nextError) {
      if (mountedRef.current && requestId === requestRef.current) setError(errorText(nextError));
    } finally {
      if (mountedRef.current && requestId === requestRef.current) setLoading(false);
    }
  }, [loadRun]);

  const startScan = useCallback(async (request: TransactionImportHistoricalScanRequest) => {
    setBusyKey("scan");
    try {
      const result = await startTransactionImportScan(request);
      selectedRunIdRef.current = result.runId;
      setSelectedRunId(result.runId);
      await refresh({ quiet: true });
      return result;
    } catch (nextError) {
      if (mountedRef.current) setError(errorText(nextError));
      throw nextError;
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  }, [refresh]);

  const commit = useCallback(async (confirmations: TransactionImportConfirmation[]) => {
    const runId = selectedRunIdRef.current;
    if (!runId) return { accepted: 0 };
    setBusyKey("commit");
    try {
      const result = await commitTransactionImportItems(runId, confirmations);
      await refresh({ quiet: true });
      return result;
    } catch (nextError) {
      if (mountedRef.current) setError(errorText(nextError));
      throw nextError;
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  }, [refresh]);

  const retry = useCallback(async (itemId: string) => {
    setBusyKey(`item:${itemId}`);
    try {
      await retryTransactionImportItem(itemId);
      await refresh({ quiet: true });
    } catch (nextError) {
      if (mountedRef.current) setError(errorText(nextError));
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  }, [refresh]);

  const dismiss = useCallback(async (itemId: string) => {
    setBusyKey(`item:${itemId}`);
    try {
      await dismissTransactionImportItem(itemId);
      await refresh({ quiet: true });
    } catch (nextError) {
      if (mountedRef.current) setError(errorText(nextError));
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  }, [refresh]);

  return {
    runs,
    totalRuns,
    pageOffset,
    changePage,
    selectedRun,
    selectedRunId,
    loading,
    active,
    busyKey,
    error,
    refresh,
    selectRun,
    startScan,
    commit,
    retry,
    dismiss,
  };
}
