import { AnimatePresence } from "motion/react";
import CompletionTransition from "../CompletionTransition";
import { useId, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, Clock, CreditCard, Mail, MailOpen } from "lucide-react";
import type { NeedsYouBandProps } from "./NeedsYouBand";
import type { NeedsYouBreakdownSegment } from "./NeedsYouCountBlock";
import type { NeedsYouCard } from "./needsYouModel";
import { StartHereStrip } from "./StartHereStrip";
import "./MobileNeedsYouList.css";

const SOURCE_ICONS = { AlertCircle, Circle, CreditCard, Mail, MailOpen, Clock };
const COLLAPSED_COUNT = 3;

interface MobileNeedsYouListProps {
  handledIds: readonly string[];
  urgentCards: NeedsYouCard[];
  countN: number;
  countColor: string;
  breakdown: NeedsYouBreakdownSegment[];
  actionError: string | null;
  onOpen: (card: NeedsYouCard) => void;
  onMarkHandled: (card: NeedsYouCard) => void;
  onComplete: (card: NeedsYouCard) => void;
  onJump: NeedsYouBandProps["onOpen"];
  recommendation: NeedsYouCard | null;
  onStartHere: (card: NeedsYouCard, anchor: HTMLButtonElement) => void;
}

export function MobileNeedsYouList({ handledIds, urgentCards, countN, countColor, breakdown, actionError, onOpen, onMarkHandled, onComplete, onJump, recommendation, onStartHere }: MobileNeedsYouListProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const headingId = useId();
  const queuedCards = recommendation ? urgentCards.filter((card) => card.id !== recommendation.id) : urgentCards;
  const collapsedQueueCount = recommendation ? COLLAPSED_COUNT - 1 : COLLAPSED_COUNT;
  const visibleCards = expanded ? queuedCards : queuedCards.slice(0, collapsedQueueCount);

  return (
    <section className="mobile-needs-you" data-testid="needs-you-band" aria-labelledby={headingId}>
      {countN === 0 ? (
        <h2 id={headingId} className="mobile-needs-you__all-clear">
          <CheckCircle2 size={18} aria-hidden="true" /> All clear
        </h2>
      ) : (
        <header className="mobile-needs-you__header">
          <h2 id={headingId} className="mobile-needs-you__heading">
            Needs you <span style={{ color: countColor }}>{countN}</span>
          </h2>
          <p className="mobile-needs-you__breakdown">
            {breakdown.map((segment, index) => (
              <span key={segment.text}>
                {index > 0 && <span aria-hidden="true"> · </span>}
                <span style={{ color: segment.color }}>{segment.text}</span>
              </span>
            ))}
          </p>
        </header>
      )}
      {actionError && <p className="mobile-needs-you__error" role="alert">{actionError}</p>}
      <AnimatePresence initial={false} custom={handledIds}>
        {recommendation && (
          <CompletionTransition key={recommendation.id} itemId={recommendation.id}>
          <StartHereStrip card={recommendation} isMobile onActivate={onStartHere}
            onMarkHandled={onMarkHandled} onComplete={onComplete} />
          </CompletionTransition>
        )}
      </AnimatePresence>
        <div role="list" id={listId} className="mobile-needs-you__list">
          <AnimatePresence initial={false} custom={handledIds}>
            {visibleCards.map((card) => {
              const SourceIcon = SOURCE_ICONS[card.sourceIcon];
              const actionLabel = card.email ? "Mark handled" : "Mark done";
              const hasAction = card.email ? card.handleable : card.completable;
              return (
                <CompletionTransition key={card.id} itemId={card.id}>
                <div role="listitem" className="mobile-needs-you__row">
                  <button
                    type="button"
                    className="mobile-needs-you__open dashboard-item-trigger sp-focus-ring"
                    aria-label={`Open ${card.source.toLowerCase()}: ${card.title}`}
                    onClick={(event) => {
                      if (card.email) onOpen(card);
                      else onJump?.({ kind: card.jumpKind, id: card.jumpId, date: card.date, data: card.data }, event.currentTarget);
                    }}
                  >
                    <SourceIcon size={16} className="mobile-needs-you__source" aria-hidden="true" />
                    <span className="mobile-needs-you__copy">
                      <span className="mobile-needs-you__title">{card.title}</span>
                      <span className="mobile-needs-you__meta">
                        <span className="mobile-needs-you__urgency">{card.pill.label}</span>
                        {` · ${card.meta}`}
                      </span>
                    </span>
                  </button>
                  {hasAction && (
                    <button
                      type="button"
                      className="mobile-needs-you__action sp-focus-ring"
                      aria-label={`${actionLabel}: ${card.title}`}
                      onClick={() => card.email ? onMarkHandled(card) : onComplete(card)}
                    >
                      <Check size={14} aria-hidden="true" />
                      <span>{actionLabel}</span>
                    </button>
                  )}
                </div>
                </CompletionTransition>
              );
            })}
          </AnimatePresence>
        </div>
      {queuedCards.length > collapsedQueueCount && (
        <button
          type="button"
          className="mobile-needs-you__disclosure sp-focus-ring"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? "Show less" : `View all ${countN}`}
          {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
      )}
    </section>
  );
}
