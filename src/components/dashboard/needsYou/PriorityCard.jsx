import { useState } from "react";
import { AlertCircle, Circle, CreditCard, Mail, MailOpen, Clock, Check, Calendar } from "lucide-react";
import { StatusChip } from "../../shared/StatusChip";
import Tooltip from "../../shared/Tooltip";
import MarkDoneAction from "../MarkDoneAction.jsx";

const SOURCE_ICONS = { AlertCircle, Circle, CreditCard, Mail, MailOpen, Clock };

const baseCardStyle = {
  position: "relative", textAlign: "left", display: "flex", flexDirection: "column",
  minWidth: 0, flex: "1 1 0", padding: "13px 14px", borderRadius: 12,
  transition: "transform 150ms cubic-bezier(0.22,1,0.36,1), box-shadow 150ms, opacity 150ms",
};

// The card body has its own hover lift; this action button owns a distinct
// hover/focus treatment (brighter tinted fill + border, slight raise) so it
// reads as a separate control from the card it sits in.
function CardActionButton({ tone, label, onClick }) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 7,
        border: `1px solid color-mix(in srgb, ${tone} ${active ? 46 : 24}%, transparent)`,
        background: `color-mix(in srgb, ${tone} ${active ? 18 : 9}%, transparent)`,
        color: tone, fontSize: 10.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
        whiteSpace: "nowrap", outline: "none",
        transform: active ? "translateY(-1px)" : "none",
        transition: "background 130ms ease, border-color 130ms ease, transform 130ms ease",
      }}
    >
      <Check size={11} color={tone} strokeWidth={2.4} />{label}
    </button>
  );
}

export function PriorityCard({ card, variant = "urgent", isMobile = false, onOpen, onMarkHandled, onComplete, onJump }) {
  const [hover, setHover] = useState(false);
  const SourceIcon = SOURCE_ICONS[card.sourceIcon] || Circle;
  const tone = variant === "backfill" ? "rgba(205,214,244,0.5)" : card.tone;
  // Every urgent card opens on a body click: emails route to the reader (no
  // separate Open button — the hover lift is the affordance), deadlines/bills
  // jump to their detail. Backfill cards don't jump.
  const bodyClickable = variant === "urgent" && (card.email || card.jumpKind != null);
  const activate = (e) => {
    if (!bodyClickable) return;
    if (card.email) onOpen?.(card);
    else onJump?.({ kind: card.jumpKind, id: card.jumpId, date: card.date, data: card.data }, e?.currentTarget);
  };
  const style = variant === "backfill"
    ? { ...baseCardStyle, background: "color-mix(in srgb, var(--sp-surface) 50%, transparent)", border: "1px solid rgba(255,255,255,0.07)", opacity: 0.94 }
    : { ...baseCardStyle,
        background: `color-mix(in srgb, ${card.tone} 7%, color-mix(in srgb, var(--sp-surface) 50%, transparent))`,
        border: `1px solid color-mix(in srgb, ${card.tone} 26%, transparent)`,
        cursor: bodyClickable ? "pointer" : "default" };

  // Footer action: emails get "Mark handled", deadlines get a real "Mark done",
  // bills get none (they aren't completable here — body click opens the calendar).
  // Backfill (upcoming) cards show their "Coming up" foot at rest; completable
  // ones (deadlines) reveal the same quiet text-only Mark-done on hover/focus —
  // subordinate to the urgent cards' filled button, since they aren't urgent.
  // On mobile there is no hover: the foot and Mark-done sit side-by-side
  // (space-between), both always visible — so the foot keeps opacity 1 (the
  // `!isMobile` guard) and the action is always-visible in flow, not absolute.
  const footer = variant === "backfill" ? (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: isMobile ? "space-between" : "flex-start", minHeight: 16 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(205,214,244,0.42)", opacity: !isMobile && card.completable && hover ? 0 : 1, transition: "opacity 130ms ease", pointerEvents: "none" }}>
        <Calendar size={11} color="rgba(205,214,244,0.42)" />{card.foot}
      </span>
      {card.completable && (
        <MarkDoneAction
          onComplete={() => onComplete?.(card)}
          revealed={hover}
          alwaysVisible={isMobile}
          itemTitle={card.title}
          style={isMobile ? undefined : { position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)" }}
        />
      )}
    </div>
  ) : card.email ? (
    card.handleable ? <CardActionButton tone={card.tone} label="Mark handled" onClick={() => onMarkHandled?.(card)} /> : null
  ) : card.completable ? (
    <CardActionButton tone={card.tone} label="Mark done" onClick={() => onComplete?.(card)} />
  ) : null;

  return (
    <div
      style={
        !hover
          ? style
          : variant === "urgent"
            ? { ...style, transform: "translateY(-2px)", boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }
            : { ...style, transform: "translateY(-1px)", boxShadow: "0 6px 16px rgba(0,0,0,0.25)", opacity: 1 }
      }
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      {...(bodyClickable
        ? {
            role: "button",
            tabIndex: 0,
            onClick: activate,
            onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(e); } },
          }
        : {})}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "rgba(205,214,244,0.6)" }}>
          <SourceIcon size={12} color={tone} strokeWidth={2.2} />{card.source}
        </span>
        <Tooltip text={card.chipTooltip}>
          <StatusChip label={card.pill.label} tone={card.pill.tone} />
        </Tooltip>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.28, color: "#dfe5f7", margin: "9px 0 6px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{card.title}</div>
      <div style={{ fontSize: 11, color: "rgba(205,214,244,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.meta}</div>
      {footer && (
        <div style={{ marginTop: 11, paddingTop: 9, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}
