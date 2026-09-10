import { X } from "lucide-react";
import EmailBodyPane from "../inbox/reader/EmailBodyPane";
import useEmailBody from "../inbox/reader/useEmailBody";

export interface EmailPreviewMessage {
  uid: string;
  subject?: string | null;
  fromName?: string;
  fromAddress?: string;
  accountId?: string | null;
  bodySnippet?: string | null;
}

/** Shared read-only preview body for Alfred and financial source records. */
export default function EmailPreviewContent({ email, dateLabel, dateTitle, onClose }: {
  email: EmailPreviewMessage; dateLabel: string; dateTitle?: string; onClose: () => void;
}) {
  const bodyState = useEmailBody({ uid: email.uid, body_preview: email.bodySnippet || "" });
  const sender = email.fromName || email.fromAddress || "";
  const senderLabel = `${sender}${email.fromAddress && email.fromAddress !== sender ? ` <${email.fromAddress}>` : ""}`;
  return <>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--sp-text)", lineHeight: 1.35, overflowWrap: "anywhere" }}>{email.subject || "(No subject)"}</div>
        <div title={dateTitle} style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 3 }}>{[senderLabel, dateLabel].filter(Boolean).join(" · ")}</div>
      </div>
      <button type="button" aria-label="Close email preview" title="Close (esc)" onClick={onClose}
        className="bg-transparent text-[rgba(205,214,244,0.55)] transition-[background-color,color,transform] hover:-translate-y-px hover:bg-white/[0.06] hover:text-foreground focus-visible:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
        style={{ display: "inline-flex", padding: "6px", minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", borderRadius: 6 }}><X size={16}/></button>
    </div>
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", scrollbarWidth: "thin" }}>
      <EmailBodyPane state={bodyState} fallback={email.bodySnippet || ""} email={{ uid: email.uid, account_id: email.accountId, from_address: email.fromAddress }}/>
    </div>
  </>;
}
