import { useState, useRef, useEffect, useCallback } from "react";

interface UseKeyHoldOptions {
  key: string;
  durationMs: number;
  onComplete?: () => void;
  enabled?: boolean;
}

interface KeyHoldState {
  active: boolean;
  progress: number;
}

export default function useKeyHold({ key, durationMs, onComplete, enabled = true }: UseKeyHoldOptions): KeyHoldState {
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  const cancel = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setActive(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== key) return;
      if (e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (timerRef.current) return; // already holding

      e.preventDefault();
      const start = Date.now();
      setActive(true);
      setProgress(0);
      intervalRef.current = setInterval(() => {
        const p = Math.min((Date.now() - start) / durationMs, 1);
        setProgress(p);
      }, 16);
      timerRef.current = setTimeout(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        timerRef.current = null;
        setActive(false);
        setProgress(0);
        onCompleteRef.current?.();
      }, durationMs);
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key !== key) return;
      cancel();
    }

    function onBlur() { cancel(); }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      cancel();
    };
  }, [key, durationMs, enabled, cancel]);

  return { active, progress };
}
