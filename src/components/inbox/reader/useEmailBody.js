import { useEffect, useState } from "react";
import { getEmailBody, peekEmailBody } from "../../../api";

export default function useEmailBody(email) {
  const emailKey = email?.uid || email?.id;
  const hasFullBody = !!email?.fullBody;
  const fallbackBody = email?.body || email?.preview || email?.body_preview || "";
  const [bodyState, setBodyState] = useState(() => {
    if (!email) return { loading: false, body: null, error: null, source: null };
    if (email.fullBody) return { loading: false, body: email.fullBody, error: null, source: "loaded" };
    const cached = peekEmailBody(emailKey);
    if (cached) {
      return { loading: false, body: cached.html_body || cached.body || "", error: null, source: "loaded" };
    }
    return { loading: true, body: null, error: null, source: "loading" };
  });

  useEffect(() => {
    if (!emailKey) return undefined;
    if (hasFullBody) {
      setBodyState({ loading: false, body: email.fullBody, error: null, source: "loaded" });
      return undefined;
    }

    const cached = peekEmailBody(emailKey);
    if (cached) {
      setBodyState({ loading: false, body: cached.html_body || cached.body || "", error: null, source: "loaded" });
      return undefined;
    }

    let cancelled = false;
    setBodyState({ loading: true, body: null, error: null, source: "loading" });
    getEmailBody(emailKey)
      .then((res) => {
        if (cancelled) return;
        setBodyState({ loading: false, body: res.html_body || res.body || "", error: null, source: "loaded" });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 404 && fallbackBody) {
          setBodyState({ loading: false, body: fallbackBody, error: null, source: "fallback" });
          return;
        }
        setBodyState({ loading: false, body: null, error: err.message || "Failed to load email", source: "error" });
      });

    return () => {
      cancelled = true;
    };
    // email.fullBody captured by hasFullBody; full object intentionally omitted
    // to avoid re-fetch on read-state mutations from parent reconciliation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailKey, hasFullBody, fallbackBody]);

  return bodyState;
}
