import { useEffect } from "react";

type WarmImport = () => Promise<unknown>;

interface UseWarmImportOptions {
  enabled?: boolean;
}

// Warm a lazy dynamic import in the background once the page is idle after first
// paint, so the first navigation that mounts it doesn't pay the cold fetch.
// Rejections are swallowed; the real lazy() mount still surfaces load errors.
export default function useWarmImport(importFn: WarmImport, { enabled = true }: UseWarmImportOptions = {}): void {
  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    const warm = () => { if (!cancelled) importFn().catch(() => {}); };
    const ric = typeof window !== "undefined" && window.requestIdleCallback;
    const idleHandle = ric ? window.requestIdleCallback(warm, { timeout: 2000 }) : null;
    const timeoutHandle = ric ? null : setTimeout(warm, 1200);
    return () => {
      cancelled = true;
      if (idleHandle !== null && window.cancelIdleCallback) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    };
  }, [importFn, enabled]);
}
