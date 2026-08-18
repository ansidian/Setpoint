import { memo, useState } from "react";
import { Clock, KeyRound, Pin } from "lucide-react";
import { LANE } from "../../lib/shell-helpers";
import { pendingSecurityGraceLabel, timeAgo } from "./helpers";
import type { InboxAccount, InboxEmailLike } from "./inboxTypes";
import { Avatar, LaneIcon } from "./primitives";
import { isVerificationCodeFresh } from "./reader/verificationCodeModel";

interface EmailRowProps {
  email: InboxEmailLike;
  account?: InboxAccount | null;
  selected?: boolean;
  onOpen: (email: InboxEmailLike) => void;
  density: string;
  showPreview?: boolean;
  accent: string;
  nowTick?: number;
  showLaneTag?: boolean;
}

function EmailRow({
  email,
  account = null,
  selected = false,
  onOpen,
  density,
  showPreview = false,
  accent,
  nowTick,
  showLaneTag = false,
}: EmailRowProps) {
  const [hover, setHover] = useState(false);
  const untriaged = email._untriaged;
  const arrivalGraceQueued = email._arrivalGraceQueued;
  const untriagedRead = email._untriagedRead;
  const laneKey = email._lane;
  const L = laneKey ? LANE[laneKey] : undefined;
  const urgColor = email.urgency === "high" ? "#f38ba8"
                  : email.urgency === "medium" ? "#fab387"
                  : "#a6adc8";
  const dimmed = email.read;
  const snapshotPending = !!email._optimisticSnapshotPending;
  const summaryColor = dimmed ? "rgba(205,214,244,0.76)" : "rgba(205,214,244,0.82)";
  const barColor = untriaged ? "#89b4fa" : (L ? L.color : "#6c7086");
  const vPad = density === "compact" ? 8 : density === "comfortable" ? 14 : 11;
  const hPad = 14;
  // Compute the pending-security-grace countdown label live from the grace
  // timestamp + the controller's nowTick, so the 30s tick actually advances it
  // (it was previously baked at row-build time and frozen between snapshots).
  // Pass nowTick straight through; when it is undefined (e.g. a row rendered
  // outside the controller in isolation) the helper falls back to Date.now()
  // in its own module scope, keeping the render body pure.
  const pendingGraceLabel = email._pendingSecurityGrace
    ? pendingSecurityGraceLabel(email._pendingSecurityGraceAt, nowTick)
    : null;
  const freshVerificationCode = isVerificationCodeFresh(email, nowTick);

  return (
    <div
      role="button"
      aria-busy={snapshotPending || undefined}
      tabIndex={0}
      onClick={() => onOpen(email)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(email); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: `${vPad}px ${hPad}px ${vPad}px ${hPad + 4}px`,
        cursor: "pointer",
        background: selected ? `${accent}14` : hover ? "rgba(255,255,255,0.025)" : "transparent",
        boxShadow: selected ? `inset 0 0 0 1px ${accent}35` : "inset 0 0 0 1px transparent",
        transition: "background 120ms, box-shadow 120ms",
        opacity: snapshotPending ? 0.6 : email._providerRemoved ? 0.55 : dimmed && !hover ? 0.82 : 1,
        // Skip layout+paint for offscreen rows (the dominant cost at large N);
        // reserve a representative row height so the scrollbar does not jump
        // before the row is first rendered. Pure CSS containment.
        contentVisibility: "auto",
        containIntrinsicSize: "auto 52px",
      }}
    >
      <div
        style={{
          position: "absolute", left: 0, top: vPad, bottom: vPad,
          width: 3, borderRadius: 2,
          background: untriaged
            ? `repeating-linear-gradient(180deg, ${barColor} 0 4px, transparent 4px 7px)`
            : barColor,
          opacity: untriaged ? 0.55 : 0.7,
          boxShadow: untriaged ? "none"
                   : `0 0 6px ${barColor}40`,
        }}
      />
      {density === "compact" ? (
        <div
          style={{
            width: 6, height: 6, marginTop: 8, borderRadius: 999,
            background: email.read ? "transparent" : urgColor, flexShrink: 0,
            boxShadow: email.read ? "none" : `0 0 6px ${urgColor}80`,
          }}
        />
      ) : (
        <Avatar
          name={email.from}
          email={email.fromEmail}
          color={account?.color || accent}
          size={density === "comfortable" ? 30 : 26}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: 12, fontWeight: email.read ? 500 : 600,
              color: email.read ? "rgba(205,214,244,0.7)" : "rgba(255,255,255,0.96)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              maxWidth: 200,
            }}
          >
            {email.from}
          </span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 10, fontVariantNumeric: "tabular-nums", fontWeight: 500,
              color: email.urgency === "high" ? urgColor : "var(--color-text-faint)",
            }}
          >
            {timeAgo(email.date)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span
            style={{
              flex: 1, fontSize: 13, fontWeight: email.read ? 400 : 600,
              color: email.read ? "rgba(205,214,244,0.78)" : "rgba(255,255,255,0.96)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {email.subject}
          </span>
          {email._pinned && <Pin size={10} color="#b4befe" data-testid="email-row-pin" style={{ flexShrink: 0 }} />}
          {freshVerificationCode && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: "rgba(205,214,244,0.78)",
                background: "rgba(205,214,244,0.06)",
                border: "1px solid rgba(205,214,244,0.16)",
              }}
              title="Verification code ready"
            >
              <KeyRound size={8} aria-hidden="true" />
              Code ready
            </span>
          )}
          {untriaged && email._resurfaced && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: "var(--sp-orange)", background: "color-mix(in srgb, var(--sp-orange) 8%, transparent)",
                border: "1px dashed color-mix(in srgb, var(--sp-orange) 32%, transparent)",
              }}
              title="Resurfaced from snooze"
            >
              <Clock size={8} />
              Snoozed
            </span>
          )}
          {untriaged && !email._resurfaced && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: "var(--sp-blue)", background: "color-mix(in srgb, var(--sp-blue) 8%, transparent)",
                border: "1px dashed color-mix(in srgb, var(--sp-blue) 28%, transparent)",
              }}
            >
              <span
                style={{
                  width: 4, height: 4, borderRadius: 999, background: "var(--sp-blue)",
                  boxShadow: "0 0 5px var(--sp-blue)",
                }}
              />
              {email._pendingSecurityGrace ? pendingGraceLabel : "Live"}
            </span>
          )}
          {arrivalGraceQueued && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: "var(--sp-blue)", background: "color-mix(in srgb, var(--sp-blue) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--sp-blue) 24%, transparent)",
              }}
            >
              <Clock size={8} />
              Queued
            </span>
          )}
          {untriagedRead && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: "rgba(205,214,244,0.58)",
                background: "rgba(205,214,244,0.05)",
                border: "1px solid rgba(205,214,244,0.09)",
              }}
            >
              Read
            </span>
          )}
          {!freshVerificationCode && !untriaged && email.urgentFlag && email._lane !== "noise" && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: urgColor, background: `${urgColor}1c`, border: `1px solid ${urgColor}35`,
              }}
            >
              {email.urgentFlag.label || email.urgency}
            </span>
          )}
          {!freshVerificationCode && showLaneTag && !untriaged && L && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                flexShrink: 0,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: L.color, background: L.soft, border: `1px solid ${L.border}`,
              }}
            >
              <LaneIcon laneKey={String(laneKey)} />
              {L.label}
            </span>
          )}
          {!freshVerificationCode && !showLaneTag && !untriaged && !arrivalGraceQueued && !untriagedRead && email.category && (
            <span
              style={{
                display: "inline-flex", alignItems: "center",
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: "rgba(205,214,244,0.62)",
                background: "rgba(205,214,244,0.06)",
                border: "1px solid rgba(205,214,244,0.10)",
              }}
            >
              {email.category.replace(/_/g, " ")}
            </span>
          )}
        </div>
        {showPreview && density !== "compact" && email.preview && (
          <div
            style={{
              marginTop: 4, fontSize: 11, color: summaryColor,
              lineHeight: 1.5,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {email.preview}
          </div>
        )}
      </div>
    </div>
  );
}

// Email row objects are rebuilt fresh on every controller recompute
// (buildInboxRow allocates a new object), so a default React.memo shallow
// compare on `email` never bails. Compare the row identity plus exactly the
// fields the render reads, so search keystrokes, lane toggles, selection
// moves, and the now-tick only re-render the rows whose visible state changed.
function rowKeyFields(email: InboxEmailLike): unknown[] {
  return [
    email.id, email.uid,
    email.read, email._lane, email._untriaged, email._resurfaced,
    email._arrivalGraceQueued, email._untriagedRead,
    email._pendingSecurityGrace, email._pendingSecurityGraceAt,
    email.urgency, email.category, email.from, email.fromEmail,
    email.subject, email.preview, email.date,
    email.urgentFlag?.label, email.urgentFlag,
    email._pinned, email._providerRemoved,
    email._optimisticSnapshotPending,
    email.verification_code?.code, email.verification_code?.active_until,
  ];
}

function areEqual(prev: EmailRowProps, next: EmailRowProps) {
  if (
    prev.selected !== next.selected
    || prev.density !== next.density
    || prev.showPreview !== next.showPreview
    || prev.accent !== next.accent
    || prev.onOpen !== next.onOpen
    || prev.account !== next.account
    || prev.showLaneTag !== next.showLaneTag
  ) {
    return false;
  }
  // nowTick only changes the rendered output for pending-security-grace rows
  // (the live countdown label). Ignore it for every other row so a tick does
  // not re-render the whole list — that is the whole point of the memo.
  if (
    (prev.email._pendingSecurityGrace
      || next.email._pendingSecurityGrace
      || prev.email.verification_code
      || next.email.verification_code)
    && prev.nowTick !== next.nowTick
  ) {
    return false;
  }
  const a = rowKeyFields(prev.email);
  const b = rowKeyFields(next.email);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default memo(EmailRow, areEqual);
