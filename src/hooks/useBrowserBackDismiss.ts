import { useCallback, useEffect, useRef } from "react";

interface UseBrowserBackDismissOptions {
  enabled: boolean;
  historyKey: string;
  onDismiss?: () => void;
}

function createToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function useBrowserBackDismiss({
  enabled,
  historyKey,
  onDismiss,
}: UseBrowserBackDismissOptions): () => void {
  const entryTokenRef = useRef<string | null>(null);
  const popDismissedRef = useRef(false);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!enabled) return undefined;

    function handlePopState(event: PopStateEvent) {
      const token = entryTokenRef.current;
      if (!token) return;
      if (event.state?.[historyKey] === token) return;
      entryTokenRef.current = null;
      popDismissedRef.current = true;
      onDismissRef.current?.();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [enabled, historyKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    if (enabled) {
      if (entryTokenRef.current) return undefined;
      const token = createToken(historyKey);
      const currentState = window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
      window.history.pushState({ ...currentState, [historyKey]: token }, "");
      entryTokenRef.current = token;
      return undefined;
    }

    const token = entryTokenRef.current;
    if (!token) return undefined;
    entryTokenRef.current = null;

    if (popDismissedRef.current) {
      popDismissedRef.current = false;
      return undefined;
    }

    if (window.history.state?.[historyKey] === token) {
      window.history.back();
    }

    return undefined;
  }, [enabled, historyKey]);

  // Mount-style consumers (rendered conditionally by a parent, e.g.
  // AnchoredFloatingPanel) unmount instead of flipping `enabled` false, so the
  // effect above never re-runs its unwind branch — this leaks the pushed entry.
  // Empty deps: runs once on unmount regardless of how `enabled` changed.
  useEffect(() => {
    return () => {
      const token = entryTokenRef.current;
      if (token && window.history.state?.[historyKey] === token) {
        window.history.back();
      }
      entryTokenRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup by design
  }, []);

  return useCallback(() => {
    if (typeof window === "undefined") {
      onDismissRef.current?.();
      return;
    }

    const token = entryTokenRef.current;
    if (token && window.history.state?.[historyKey] === token) {
      window.history.back();
      return;
    }

    entryTokenRef.current = null;
    onDismissRef.current?.();
  }, [historyKey]);
}
