import EmailIframe from "../../email/EmailIframe";
import { useRemoteContentTrust } from "../../../hooks/useRemoteContentTrust";
import type { InboxEmailLike } from "../inboxTypes";
import type { EmailBodyState } from "./readerTypes";

export default function EmailBodyPane({ state, fallback, isMobile = false, presentation = "original", email }: {
  state: EmailBodyState;
  fallback?: string | null;
  isMobile?: boolean;
  presentation?: "reading" | "original";
  email?: InboxEmailLike | null;
}) {
  const accountId = email?.account_id || email?.accountId || email?._account?.account_id || email?._account?.id;
  const senderAddress = email?.from_address || email?.fromEmail || email?.from_email;
  const messageKey = email?.uid || email?.email_id || email?.id;
  const remoteContentTrust = useRemoteContentTrust(accountId, senderAddress);
  const { loading, body, error } = state;
  if (loading) {
    return (
      <div style={{ padding: "22px 24px", display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 12, height: 12, borderRadius: "50%",
            border: "1.5px solid rgba(255,255,255,0.06)",
            borderTopColor: "rgba(205,214,244,0.6)",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>Loading email…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: "22px 24px", fontSize: 12, color: "var(--sp-rose)" }}>{error}</div>
    );
  }
  const text = body || fallback;
  if (!text) {
    return (
      <div style={{ padding: "22px 24px", fontSize: 12, color: "var(--color-text-faint)" }}>
        Email body unavailable.
      </div>
    );
  }
  const isHtml = /<[a-z!/]/i.test(text);
  if (isHtml) {
    // Mobile expands into the reader scroll; desktop retains its own iframe scroll.
    return (
      <div
        data-testid={isMobile ? "inbox-mobile-reader-body" : undefined}
        style={{
          flex: isMobile ? undefined : 1,
          minHeight: 0,
          display: "flex",
          padding: isMobile ? "0" : "12px 16px 16px",
        }}
      >
        <div
          style={{
            flex: isMobile ? undefined : 1,
            minHeight: 0,
            width: "100%",
            borderRadius: isMobile ? 0 : 8,
            overflow: "hidden",
            background: "#fff",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <EmailIframe
            html={text}
            presentation={state.source === "loaded" ? presentation : "original"}
            isMobile={isMobile}
            messageKey={messageKey != null ? String(messageKey) : null}
            remoteContentTrust={{
              status: remoteContentTrust.status,
              senderAddress: remoteContentTrust.senderAddress,
              onTrustSender: remoteContentTrust.trustSender,
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <div
      data-testid={isMobile ? "inbox-mobile-reader-body" : undefined}
      style={{
        flex: isMobile ? undefined : 1,
        minHeight: 0,
        overflowY: isMobile ? undefined : "auto",
        padding: isMobile ? "16px 16px 12px" : "22px 24px 28px",
      }}
    >
      <div
        style={{
          fontSize: 13.5, lineHeight: presentation === "reading" ? 1.95 : 1.7, color: "rgba(205,214,244,0.88)",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </div>
  );
}
