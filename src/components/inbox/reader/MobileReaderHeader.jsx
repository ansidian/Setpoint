import { Ellipsis } from "lucide-react";
import { timeClock, timeSince } from "../helpers";
import { Avatar } from "../primitives";
import { InlineControlButton, MobileStatusPill } from "./MobileReaderControls.jsx";

// Mobile reader's subject/meta block: subject + actions toggle, sender row with
// avatar and timestamps, status pills, and the briefing-triage summary.
// Extracted from MobileReader; the top nav bar (back/account) stays in the
// reader since it sits at a different DOM level.
export default function MobileReaderHeader({
  email,
  account,
  accent,
  actionsBtnRef,
  actionsActive,
  onToggleActions,
  isQueuedSnapshot,
  isUntriagedReadSnapshot,
  billOpen,
  drafting,
  triageSummary,
}) {
  return (
    <div style={{ padding: "10px 16px 8px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <h1
          className="ea-display"
          style={{
            flex: 1,
            margin: 0,
            fontSize: 18,
            lineHeight: 1.06,
            fontWeight: 500,
            letterSpacing: -0.35,
            color: "#fff",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {email.subject}
        </h1>
        <InlineControlButton
          buttonRef={actionsBtnRef}
          icon={Ellipsis}
          label="Actions"
          active={actionsActive}
          onClick={onToggleActions}
        />
      </div>

      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 9 }}>
        <Avatar
          name={email.from}
          email={email.fromEmail}
          color={account?.color || accent}
          size={28}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {email.from}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--color-text-faint)",
              marginTop: 1,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{timeClock(email.date)}</span>
            <span style={{ opacity: 0.35 }}>·</span>
            <span>{timeSince(email.date)}</span>
            {account?.name && (
              <>
                <span style={{ opacity: 0.35 }}>·</span>
                <span style={{ color: account.color || accent }}>{account.name}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {email._untriaged && (
          <MobileStatusPill color="#89b4fa" label="Live" />
        )}
        {isQueuedSnapshot && (
          <MobileStatusPill color="#89b4fa" label="Queued" subtle />
        )}
        {isUntriagedReadSnapshot && (
          <MobileStatusPill color="#a6adc8" label="Read" subtle />
        )}
        {billOpen && (
          <MobileStatusPill color="#a6e3a1" label="Bill pay open" subtle />
        )}
        {drafting && <MobileStatusPill color={accent} label="Draft open" subtle />}
      </div>

      {triageSummary && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 12,
            background: `linear-gradient(135deg, ${accent}12, color-mix(in srgb, var(--sp-cyan) 4%, transparent))`,
            border: `1px solid ${accent}2c`,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: accent,
            }}
          >
            Briefing triage
          </div>
          <div
            className="ea-display"
            style={{
              marginTop: 4,
              fontSize: 11.5,
              lineHeight: 1.45,
              color: "rgba(255,255,255,0.9)",
            }}
          >
            {triageSummary}
          </div>
        </div>
      )}
    </div>
  );
}
