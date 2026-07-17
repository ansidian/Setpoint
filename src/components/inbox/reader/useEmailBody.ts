import { useEffect, useState } from "react";
import { getEmailBody, peekEmailBody } from "../../../api";
import type { EmailBody } from "../../../../shared/types/email";
import type { InboxEmailLike } from "../inboxTypes";
import type { EmailBodyState } from "./readerTypes";

function bodyFromResponse(response: EmailBody): string {
  return "html_body" in response ? response.html_body : response.body;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to load email";
}

export default function useEmailBody(email: InboxEmailLike | null | undefined): EmailBodyState {
  const rawEmailKey = email?.uid || email?.id;
  const emailKey = rawEmailKey == null ? null : String(rawEmailKey);
  const hasFullBody = !!email?.fullBody;
  const fallbackBody = email?.body || email?.preview || email?.body_preview || "";
  const [bodyState, setBodyState] = useState<EmailBodyState>(() => {
    if (!email) return { loading: false, body: null, error: null, source: null };
    if (email.fullBody) return { loading: false, body: email.fullBody, error: null, source: "loaded" };
    const cached = emailKey ? peekEmailBody(emailKey) : null;
    if (cached) {
      return { loading: false, body: bodyFromResponse(cached), error: null, source: "loaded" };
    }
    return { loading: true, body: null, error: null, source: "loading" };
  });

  useEffect(() => {
    if (!emailKey) return undefined;
    if (hasFullBody) {
      setBodyState({ loading: false, body: email?.fullBody || "", error: null, source: "loaded" });
      return undefined;
    }

    const cached = peekEmailBody(emailKey);
    if (cached) {
      setBodyState({ loading: false, body: bodyFromResponse(cached), error: null, source: "loaded" });
      return undefined;
    }

    let cancelled = false;
    setBodyState({ loading: true, body: null, error: null, source: "loading" });
    getEmailBody(emailKey)
      .then((res) => {
        if (cancelled) return;
        setBodyState({ loading: false, body: bodyFromResponse(res), error: null, source: "loaded" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Prefer any available fallback (row preview / cached body) over a hard error for
        // ANY rejection -- not just 404. Transient 5xx / network failures should still show
        // the preview text we already have in hand. 'error' is reserved for the no-fallback case.
        if (fallbackBody) {
          setBodyState({ loading: false, body: fallbackBody, error: null, source: "fallback" });
          return;
        }
        setBodyState({ loading: false, body: null, error: errorMessage(err), source: "error" });
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
