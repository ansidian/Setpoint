import { AlertCircle, ArrowUpRight, Check, Circle, Clock, CreditCard, Mail, MailOpen } from "lucide-react";
import type { CSSProperties } from "react";
import type { NeedsYouCard } from "./needsYouModel";
import "./StartHereStrip.css";

function recommendationDetail(card: NeedsYouCard) {
  return [card.pill.label, card.meta].filter(Boolean).join(" · ");
}

const SOURCE_ICONS = { AlertCircle, Circle, CreditCard, Mail, MailOpen, Clock };

function recommendationAction(card: NeedsYouCard, isMobile: boolean) {
  if (card.email) return isMobile ? "Open email" : "Preview email";
  if (card.jumpKind === "bill") return "Review bill";
  return "Open task";
}

export function StartHereStrip({
  card,
  isMobile = false,
  onActivate,
  onOpenEmail,
  onComplete,
}: {
  card: NeedsYouCard;
  isMobile?: boolean;
  onActivate: (card: NeedsYouCard, anchor: HTMLButtonElement) => void;
  onOpenEmail: (card: NeedsYouCard) => void;
  onComplete: (card: NeedsYouCard) => void;
}) {
  const detail = recommendationDetail(card);
  const action = recommendationAction(card, isMobile);
  const SourceIcon = SOURCE_ICONS[card.sourceIcon] || Circle;
  const quickAction = card.email ? "Open email" : "Mark done";
  const QuickIcon = card.email ? ArrowUpRight : Check;
  const hasQuickAction = card.email ? !isMobile : card.completable;

  return (
    <div
      className={`start-here-strip${isMobile ? " start-here-strip--mobile" : ""}`}
      style={{ "--start-here-tone": card.tone || "var(--sp-accent)" } as CSSProperties}
    >
      <button
        type="button"
        className="start-here-strip__open dashboard-item-trigger sp-focus-ring"
        data-dashboard-detail-trigger={!isMobile ? "true" : undefined}
        aria-label={`${action}: ${card.title}. ${detail}`}
        title={`${card.title} — ${detail}`}
        onClick={(event) => onActivate(card, event.currentTarget)}
      >
        <span className="start-here-strip__cue">
          <SourceIcon size={14} strokeWidth={2.2} color={card.tone || "var(--sp-accent)"} aria-hidden="true" />
          <span className="start-here-strip__cue-label">Start here</span>
        </span>
        <span className="start-here-strip__copy">
          <span className="start-here-strip__title">{card.title}</span>
          <span className="start-here-strip__detail">{detail}</span>
        </span>
        <span className="start-here-strip__action" aria-hidden="true">
          {action}
        </span>
      </button>
      {hasQuickAction && (
        <button
          type="button"
          className="start-here-strip__quick-action sp-focus-ring"
          aria-label={`${quickAction}: ${card.title}`}
          title={`${quickAction}: ${card.title}`}
          onClick={() => card.email ? onOpenEmail(card) : onComplete(card)}
        >
          <QuickIcon size={13} strokeWidth={2.4} aria-hidden="true" />
          <span className="start-here-strip__quick-label">{quickAction}</span>
        </button>
      )}
    </div>
  );
}
