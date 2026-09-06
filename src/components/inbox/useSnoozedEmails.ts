import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSnoozedEmails, unsnoozeEmail } from "../../api";
import type { SnoozedEmailEntry } from "../../../shared/types/email";

// Owns deferred collection I/O independently of snapshot selection and history.
export default function useSnoozedEmails(active: boolean) {
  const [entries, setEntries] = useState<SnoozedEmailEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [returningUid, setReturningUid] = useState<string | null>(null);
  const request = useRef(0);
  const returning = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    try {
      const next = await fetchSnoozedEmails();
      if (token !== request.current) return;
      setEntries(next);
      setError(null);
    } catch (err) {
      if (token === request.current) setError(err instanceof Error ? err.message : "Couldn't load snoozed mail.");
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(onFocus, active ? 30_000 : 60_000);
    const requestCounter = request;
    return () => {
      ++requestCounter.current;
      window.removeEventListener("focus", onFocus);
      if (interval != null) window.clearInterval(interval);
    };
  }, [active, refresh]);

  const returnEarly = useCallback(async (uid: string): Promise<boolean> => {
    if (returning.current) return false;
    returning.current = uid;
    setReturningUid(uid);
    ++request.current;
    try {
      await unsnoozeEmail(uid);
      ++request.current;
      setEntries((previous) => previous.filter((entry) => entry.uid !== uid));
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't return this email. It is still snoozed.");
      return false;
    } finally {
      returning.current = null;
      setReturningUid(null);
      setLoading(false);
    }
  }, []);
  return { entries, loading, error, refresh, returningUid, returnEarly };
}
