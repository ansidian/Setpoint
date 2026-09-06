import { useState } from "react";
import { AlertCircle, Circle, CreditCard, Mail, MailOpen, Clock, Check, Calendar } from "lucide-react";
import { StatusChip } from "../../shared/StatusChip";
import Tooltip from "../../shared/Tooltip";
import MarkDoneAction from "../MarkDoneAction";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { NeedsYouCard } from "./needsYouModel";

export type PriorityCardModel = NeedsYouCard;

const SOURCE_ICONS = { AlertCircle, Circle, CreditCard, Mail, MailOpen, Clock };

const baseCardStyle: CSSProperties = {
  position: "relative", textAlign: "left", display: "flex", flexDirection: "column",
  minWidth: 0, flex: "1 1 0", padding: "12px", borderRadius: 12,
  transition: "transform 160ms ease, background-color 160ms ease, border-color 160ms ease, opacity 160ms ease",
};

// The card body has its own hover lift; this action button owns a distinct
// hover/focus treatment (brighter tinted fill + border, slight raise) so it
// reads as a separate control from the card it sits in.
function CardActionButton({ tone, label, onClick }: { tone: string; label: string; onClick?: () => void }) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      className="needs-you-card-action sp-focus-ring"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, minHeight: 30, padding: "5px 8px", borderRadius: 6,
        border: `1px solid ${active ? `color-mix(in srgb, ${tone} 30%, transparent)` : "rgba(255,255,255,0.09)"}`,
        background: active ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.025)",
        color: "var(--sp-text)", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
        whiteSpace: "nowrap",
        transform: active ? "translateY(-1px)" : "none",
        transition: "background 130ms ease, border-color 130ms ease, transform 130ms ease",
      }}
    >
      <Check size={11} color={tone} strokeWidth={2.4} />{label}
    </button>
  );
}

export function PriorityCard({ card, variant = "urgent", isMobile = false, onOpen, onMarkHandled, onComplete, onJump }: {
  card: PriorityCardModel;
  variant?: "urgent" | "backfill";
  isMobile?: boolean;
  onOpen?: (card: PriorityCardModel) => void;
  onMarkHandled?: (card: PriorityCardModel) => void;
  onComplete?: (card: PriorityCardModel) => void;
  onJump?: (payload: { kind?: string | null; id?: string | number | null; date?: string | null; data?: unknown }, anchor?: HTMLElement) => void;
}) {
  const [hover, setHover] = useState(false);
  const SourceIcon = SOURCE_ICONS[card.sourceIcon] || Circle;
  const cardTone = card.tone || "var(--sp-rose)";
  const tone = variant === "backfill" ? "rgba(205,214,244,0.5)" : cardTone;
  // Every card with a destination opens on a body click: emails route to the
  // reader, while deadline/bill cards jump to their existing detail treatment.
  const bodyClickable = card.email || card.jumpKind != null;
  const activate = (e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    if (!bodyClickable) return;
    if (card.email) onOpen?.(card);
    else onJump?.({ kind: card.jumpKind, id: card.jumpId, date: card.date, data: card.data }, e?.currentTarget);
  };
  const style = { ...baseCardStyle, background: "rgba(255,255,255,0.015)",
    border: "1px solid rgba(255,255,255,0.07)", cursor: bodyClickable ? "pointer" : "default" };

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
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-secondary, #a6adc8)", opacity: !isMobile && card.completable && hover ? 0 : 1, transition: "opacity 130ms ease", pointerEvents: "none" }}>
        <Calendar size={11} color="var(--color-text-secondary, #a6adc8)" />{card.foot}
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
    card.handleable ? <CardActionButton tone={cardTone} label="Mark handled" onClick={() => onMarkHandled?.(card)} /> : null
  ) : card.completable ? (
    <CardActionButton tone={cardTone} label="Mark done" onClick={() => onComplete?.(card)} />
  ) : null;

  return (
    <div
      className={bodyClickable ? "needs-you-priority-card dashboard-item-trigger sp-focus-ring" : "needs-you-priority-card"}
      style={
        !hover
          ? style
          : { ...style, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.12)" }
      }
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      {...(bodyClickable
        ? {
            role: "button",
            tabIndex: 0,
            onClick: activate,
            onKeyDown: (e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(e); }
            },
          }
        : {})}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary, #a6adc8)" }}>
          <SourceIcon size={12} color={tone} strokeWidth={2.2} />{card.source}
        </span>
        <Tooltip text={card.chipTooltip}>
          <StatusChip label={card.pill.label} tone={card.pill.tone} />
        </Tooltip>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: "var(--sp-text)", margin: "8px 0 4px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{card.title}</div>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--color-text-secondary, #a6adc8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.meta}</div>
      {footer && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}
