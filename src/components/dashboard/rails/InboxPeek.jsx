import { memo, useMemo } from "react";
import { Inbox } from "lucide-react";
import { deriveLane } from "../../../lib/shell-helpers";
import {
  EmptyRow,
  OpenInboxButton,
  SectionHeader,
} from "./railPrimitives.jsx";
import { timeAgo } from "./railModel.js";

const MAX_VISIBLE_EMAILS = 4;
const INBOX_ROW_MIN_HEIGHT = 46;

function InboxPeek({ accent = "#cba6da", emailAccounts = [], onJump, onOpenInbox, isMobile = false }) {
  const flat = useMemo(() => {
    const all = [];
    for (const acc of emailAccounts) {
      for (const e of acc.important || []) {
        all.push({ ...e, _account: acc, _lane: deriveLane(e) });
      }
    }
    return all
      .sort((a, b) => (a.read === b.read ? new Date(b.date) - new Date(a.date) : (a.read ? 1 : 0) - (b.read ? 1 : 0)))
      .slice(0, MAX_VISIBLE_EMAILS);
  }, [emailAccounts]);

  const needsYou = flat.filter((e) => e._lane === "needs_attention" && !e.read).length;

  return (
    <div data-sect="inbox-peek">
      <SectionHeader
        title="Inbox peek"
        isMobile={isMobile}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {needsYou > 0 && (
              <span
                style={{
                  fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 99,
                  background: "rgba(243,139,168,0.15)", color: "#f38ba8",
                }}
              >
                {needsYou} needs you
              </span>
            )}
            <OpenInboxButton accent={accent} onClick={onOpenInbox} />
          </div>
        }
      />
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          maxHeight: isMobile ? undefined : INBOX_ROW_MIN_HEIGHT * MAX_VISIBLE_EMAILS,
          overflow: "hidden",
        }}
      >
        {flat.map((e) => (
          <div
            key={e.id}
            role="button"
            tabIndex={0}
            onClick={() => onJump?.({ kind: "email", id: e.id, email: e })}
            onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") onJump?.({ kind: "email", id: e.id, email: e }); }}
            style={{
              display: "grid", gridTemplateColumns: isMobile ? "18px minmax(0, 1fr)" : "18px 1fr auto", gap: 10, alignItems: isMobile ? "start" : "center",
              minHeight: isMobile ? undefined : INBOX_ROW_MIN_HEIGHT,
              padding: isMobile ? "10px 2px" : "9px 2px", borderBottom: "1px solid rgba(255,255,255,0.04)",
              cursor: "pointer",
            }}
            onMouseEnter={(ev) => { ev.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
            onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
          >
            <div
              style={{
                width: 6, height: 6, borderRadius: 99,
                background:
                  e._lane === "needs_attention" ? "#f38ba8"
                  : e._lane === "fyi" ? "#89dceb"
                  : "rgba(205,214,244,0.25)",
                margin: "0 auto",
                opacity: e.read ? 0.35 : 1,
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12, color: e.read ? "rgba(205,214,244,0.65)" : "#cdd6f4",
                  fontWeight: e.read ? 400 : 600,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isMobile ? "normal" : "nowrap",
                  marginBottom: 2,
                }}
              >
                {e.subject}
              </div>
              <div
                style={{
                  fontSize: 10.5, color: "rgba(205,214,244,0.45)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isMobile ? "normal" : "nowrap",
                }}
              >
                {e.from}
              </div>
              {isMobile && (
                <div
                  style={{
                    fontSize: 9.5, color: "rgba(205,214,244,0.35)",
                    fontVariantNumeric: "tabular-nums",
                    marginTop: 6,
                  }}
                >
                  {timeAgo(e.date)}
                </div>
              )}
            </div>
            {!isMobile && (
              <div
                style={{
                  fontSize: 9.5, color: "rgba(205,214,244,0.35)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {timeAgo(e.date)}
              </div>
            )}
          </div>
        ))}
        {flat.length === 0 && <EmptyRow icon={Inbox} label="Nothing new — inbox is calm" />}
      </div>
    </div>
  );
}

// Memoized so dashboard poll/refresh ticks that leave emailAccounts/onJump/onOpenInbox
// untouched do not re-render this rail.
export default memo(InboxPeek);
