import { AlertCircle, Mail, RefreshCw, X } from "lucide-react";
import type {
  AlfredEmailAttachmentRef,
} from "../../../shared/types/alfred";
import { formatAlfredAbsolute, formatAlfredAgo } from "./alfredPanelModel";
import { pendingEmailAttachment, type AlfredPendingEmailContext } from "./alfredEmailContextModel";

const muted = "rgba(205,214,244,0.58)";
const faint = "var(--color-text-faint)";

function EmailIdentity({ attachment }: { attachment: AlfredEmailAttachmentRef }) {
  const time = formatAlfredAgo(attachment.timestamp);
  const absolute = formatAlfredAbsolute(attachment.timestamp);
  return (
    <span style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2, textAlign: "left" }}>
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
        className="transition-[background-color,color] duration-150 hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ea-accent)]/60 active:bg-white/[0.055] motion-reduce:transition-none"
        style={{
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "28px minmax(0, 1fr)",
          alignItems: "center",
          columnGap: 9,
          padding: "9px 8px 8px 10px",
          background: "transparent",
          border: 0,
          color: "inherit",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ width: 28, height: 28, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `${accent}17`, color: accent }}>
          <Mail size={13} />
        </span>
        <EmailIdentity attachment={attachment} />
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
        className="transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 active:bg-white/[0.07] motion-reduce:transition-none motion-reduce:transform-none"
        style={{ alignSelf: "start", margin: 6, padding: 5, border: 0, borderRadius: 6, background: "transparent", color: muted, cursor: "pointer", display: "inline-flex" }}
      >
        <X size={11} />
      </button>
      {failed ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 8px 47px", minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, color: muted, fontSize: 9.5, lineHeight: 1.4, overflowWrap: "anywhere" }}>
            {pending.error || "The full email could not be prepared."}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
            style={{ padding: "4px 7px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)", color: "var(--sp-text)", cursor: "pointer", fontFamily: "inherit", fontSize: 9.5, whiteSpace: "nowrap" }}
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
        className="transition-[background-color,color] duration-150 hover:bg-white/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ea-accent)]/60 active:bg-white/[0.065] motion-reduce:transition-none"
        style={{ border: 0, borderLeft: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "var(--sp-text)", padding: "7px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 9.5, fontWeight: 600, whiteSpace: "nowrap" }}
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
      className="transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:bg-white/[0.045] hover:border-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 active:translate-y-0 active:bg-white/[0.065] motion-reduce:transition-none motion-reduce:transform-none"
      style={{
        width: "min(92%, 320px)",
        display: "grid",
        gridTemplateColumns: "24px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 8,
        padding: "7px 8px",
        borderRadius: 9,
        border: `1px solid ${failed ? "color-mix(in srgb, var(--sp-rose) 28%, transparent)" : "rgba(255,255,255,0.07)"}`,
        background: failed ? "color-mix(in srgb, var(--sp-rose) 4%, transparent)" : "rgba(255,255,255,0.018)",
        color: "inherit",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span style={{ width: 24, height: 24, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.035)", color: failed ? "var(--sp-rose)" : "var(--sp-blue)" }}>
        <Mail size={11} />
      </span>
      <EmailIdentity attachment={attachment} />
      {failed ? <span style={{ color: "var(--sp-rose)", fontSize: 9, fontWeight: 600 }}>Failed</span> : null}
    </button>
  );
}
