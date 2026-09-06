import { AlertCircle, ChevronRight, Mail, RefreshCw, X } from "lucide-react";
import type {
  AlfredEmailAttachmentRef,
} from "../../../shared/types/alfred";
import { formatAlfredAbsolute, formatAlfredAgo } from "./alfredPanelModel";
import { pendingEmailAttachment, type AlfredPendingEmailContext } from "./alfredEmailContextModel";

import "./AlfredEvidence.css";

const muted = "rgba(205,214,244,0.58)";
const faint = "var(--color-text-faint)";

function EmailIdentity({ attachment, label }: { attachment: AlfredEmailAttachmentRef; label: string }) {
  const time = formatAlfredAgo(attachment.timestamp);
  const absolute = formatAlfredAbsolute(attachment.timestamp);
  return (
    <span style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2, textAlign: "left" }}>
      <span style={{ color: "var(--sp-subtext)", fontSize: 10 }}>{label}</span>
      <span style={{ color: "var(--sp-text)", fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {attachment.subject}
      </span>
      <span style={{ color: faint, fontSize: 9.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {attachment.sender.display}{time ? " · " : ""}<span title={absolute}>{time}</span>
      </span>
    </span>
  );
}

export function AlfredPendingEmailContextCard({
  pending,
  accent,
  onPreview,
  onRetry,
  onRemove,
}: {
  pending: AlfredPendingEmailContext;
  accent: string;
  onPreview: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const attachment = pendingEmailAttachment(pending);
  const preparing = pending.status === "preparing";
  const failed = pending.status === "error";
  const status = preparing ? "Preparing email…" : failed ? "Couldn’t prepare email" : "Ready";
  const statusColor = failed ? "var(--sp-rose)" : preparing ? accent : "var(--sp-green)";

  return (
    <div
      data-testid="alfred-pending-email-context"
      data-state={pending.status}
      className="alfred-context-enter"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        borderRadius: 10,
        border: `1px solid ${failed ? "color-mix(in srgb, var(--sp-rose) 32%, transparent)" : `${accent}2e`}`,
        background: failed ? "color-mix(in srgb, var(--sp-rose) 5%, var(--sp-panel))" : `${accent}0d`,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview attached email: ${attachment.subject}`}
        className="alfred-attachment-preview"
        style={{
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "28px minmax(0, 1fr)",
          alignItems: "center",
          columnGap: 9,
          padding: "9px 8px 8px 10px",
          border: 0,
          color: "inherit",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ width: 28, height: 28, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `${accent}17`, color: accent }}>
          <Mail size={13} />
        </span>
        <EmailIdentity attachment={attachment} label="Email attached" />
        <span style={{ gridColumn: "2", display: "inline-flex", alignItems: "center", gap: 5, color: statusColor, fontSize: 9.5, marginTop: 3, textAlign: "left" }}>
          {preparing ? <RefreshCw className="alfred-context-spinner" size={9} /> : failed ? <AlertCircle size={9} /> : null}
          {status}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove attached email: ${attachment.subject}`}
        title="Remove email"
        className="alfred-attachment-remove"
        style={{ alignSelf: "start", margin: 8 }}
      >
        <X size={14} />
      </button>
      {failed ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 8px 47px", minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, color: muted, fontSize: 9.5, lineHeight: 1.4, overflowWrap: "anywhere" }}>
            {pending.error || "The full email could not be prepared."}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="alfred-attachment-retry"
            style={{ padding: "4px 7px", borderRadius: 6, color: "var(--sp-text)", cursor: "pointer", fontFamily: "inherit", fontSize: 9.5, whiteSpace: "nowrap" }}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AlfredEmailHistoryNotice({
  count,
  overflowRecovery,
  onStartNewChat,
}: {
  count: number;
  overflowRecovery: boolean;
  onStartNewChat: () => void;
}) {
  const label = overflowRecovery
    ? "This chat is too long for the selected model."
    : `This chat includes ${count} earlier email${count === 1 ? "" : "s"}.`;
  return (
    <div
      role="status"
      style={{
        minHeight: 34,
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "color-mix(in srgb, var(--sp-blue) 5%, var(--sp-panel))",
        color: muted,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 10px", fontSize: 9.5, lineHeight: 1.35 }}>
        {overflowRecovery ? <AlertCircle size={11} color="var(--sp-blue)" /> : <Mail size={11} color="var(--sp-blue)" />}
        {label}
      </span>
      <button
        type="button"
        onClick={onStartNewChat}
        className="alfred-attachment-preview"
        style={{ border: 0, borderLeft: "1px solid rgba(255,255,255,0.06)", color: "var(--sp-text)", padding: "7px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 9.5, fontWeight: 600, whiteSpace: "nowrap" }}
      >
        Start new chat
      </button>
    </div>
  );
}

export function AlfredSentEmailReference({
  attachment,
  failed = false,
  onPreview,
}: {
  attachment: AlfredEmailAttachmentRef;
  failed?: boolean;
  onPreview: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPreview}
      aria-label={`Preview ${failed ? "failed " : ""}email attachment: ${attachment.subject}`}
      className="alfred-sent-attachment"
      data-failed={failed || undefined}
      style={{
        width: "min(92%, 320px)",
        display: "grid",
        gridTemplateColumns: "24px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 8,
        padding: "7px 8px",
        borderRadius: 9,
        color: "inherit",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span style={{ width: 24, height: 24, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.035)", color: failed ? "var(--sp-rose)" : "var(--sp-blue)" }}>
        <Mail size={11} />
      </span>
      <EmailIdentity attachment={attachment} label={failed ? "Email attachment · failed" : "Email attached"} />
      <span className="alfred-evidence-action" aria-hidden="true">View <ChevronRight size={13} /></span>
    </button>
  );
}
