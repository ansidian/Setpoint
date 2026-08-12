import EmailIframe from "../../email/EmailIframe";
import { useRemoteContentTrust } from "../../../hooks/useRemoteContentTrust";
import type { InboxEmailLike } from "../inboxTypes";
import type { EmailBodyState } from "./readerTypes";

export default function EmailBodyPane({ state, fallback, isMobile = false, email }: {
  state: EmailBodyState;
  fallback?: string | null;
  isMobile?: boolean;
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
    // Iframe handles its own scroll; outer wrapper just clips and tints.
    return (
      <div
        data-testid={isMobile ? "inbox-mobile-reader-body" : undefined}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          padding: isMobile ? "0 16px 12px" : "12px 16px 16px",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            borderRadius: 8,
            overflow: "hidden",
            background: "#fff",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <EmailIframe
            html={text}
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
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: isMobile ? "16px 16px 12px" : "22px 24px 28px",
      }}
    >
      <div
        style={{
          fontSize: 13.5, lineHeight: 1.7, color: "rgba(205,214,244,0.88)",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </div>
  );
}
