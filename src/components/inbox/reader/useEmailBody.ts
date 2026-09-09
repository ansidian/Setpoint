import { useEffect, useState } from "react";
import { getEmailBody, peekEmailBody } from "../../../api";
import type { EmailBody } from "../../../../shared/types/email";
import type { InboxEmailLike } from "../inboxTypes";
import type { EmailBodyState } from "./readerTypes";

function loadedBodyState(response: EmailBody, messageKey: string): EmailBodyState {
  return {
    loading: false,
    body: "html_body" in response ? response.html_body : response.body,
    error: null,
    source: "loaded",
    attachments: response.attachments || [],
    remoteContentIdentity: response.account_id && response.from_address
      ? { messageKey, accountId: response.account_id, senderAddress: response.from_address }
      : undefined,
  };
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
    if (!email) return { loading: false, body: null, error: null, source: null, attachments: [] };
    if (email.fullBody) return { loading: false, body: email.fullBody, error: null, source: "loaded", attachments: [] };
    const cached = emailKey ? peekEmailBody(emailKey) : null;
    if (cached && emailKey) {
      return loadedBodyState(cached, emailKey);
    }
    return { loading: true, body: null, error: null, source: "loading", attachments: [] };
  });

  useEffect(() => {
    if (!emailKey) return undefined;
    if (hasFullBody) {
      setBodyState({ loading: false, body: email?.fullBody || "", error: null, source: "loaded", attachments: [] });
      return undefined;
    }

    const cached = peekEmailBody(emailKey);
    if (cached) {
      setBodyState(loadedBodyState(cached, emailKey));
      return undefined;
    }

    let cancelled = false;
    setBodyState({ loading: true, body: null, error: null, source: "loading", attachments: [] });
    getEmailBody(emailKey)
      .then((res) => {
        if (cancelled) return;
        setBodyState(loadedBodyState(res, emailKey));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Prefer any available fallback (row preview / cached body) over a hard error for
        // ANY rejection -- not just 404. Transient 5xx / network failures should still show
        // the preview text we already have in hand. 'error' is reserved for the no-fallback case.
        if (fallbackBody) {
          setBodyState({ loading: false, body: fallbackBody, error: null, source: "fallback", attachments: [] });
          return;
        }
        setBodyState({ loading: false, body: null, error: errorMessage(err), source: "error", attachments: [] });
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
