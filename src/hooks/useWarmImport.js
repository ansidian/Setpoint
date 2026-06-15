import { useEffect } from "react";

// Warm a lazy dynamic import in the background once the page is idle after first
// paint, so the first navigation that mounts it doesn't pay the cold fetch.
// Rejections are swallowed; the real lazy() mount still surfaces load errors.
export default function useWarmImport(importFn) {
  useEffect(() => {
    let cancelled = false;
    const warm = () => { if (!cancelled) importFn().catch(() => {}); };
    const ric = typeof window !== "undefined" && window.requestIdleCallback;
    const handle = ric ? window.requestIdleCallback(warm, { timeout: 2000 }) : setTimeout(warm, 1200);
    return () => {
      cancelled = true;
      if (ric && window.cancelIdleCallback) window.cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [importFn]);
}
