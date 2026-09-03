import { memo, useState } from "react";
import AnimatedHeight from "../shared/AnimatedHeight";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  MapPin,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { AlfredCalendarProposal } from "../../../shared/types/alfred";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import { createdEventSchedule } from "./alfredCalendarProposalModel";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T12:00:00.000Z`));
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(new Date(2026, 0, 1, hour, minute));
}

function scheduleLabel({
  allDay,
  startDate,
  endDate,
  startTime,
  endTime,
}: {
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
}): string {
  const date = startDate === endDate
    ? formatDate(startDate)
    : `${formatDate(startDate)} – ${formatDate(endDate)}`;
  if (allDay) return `${date} · All day`;
  return `${date} · ${formatTime(startTime)}–${formatTime(endTime)}`;
}

export interface AlfredCalendarProposalCardProps {
  proposal: AlfredCalendarProposal;
  status: "proposed" | "superseded" | "created";
  handoffError: string | null;
  createdEvent: NormalizedCalendarEvent | null;
  editedInCalendar: boolean;
  accent: string;
  onReview: () => Promise<boolean>;
  onOpenEvent: () => void;
}

function AlfredCalendarProposalCard({
  proposal,
  status,
  handoffError,
  createdEvent,
  editedInCalendar,
  accent,
  onReview,
  onOpenEvent,
}: AlfredCalendarProposalCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const createdSchedule = createdEvent ? createdEventSchedule(createdEvent) : null;
  const display = createdEvent
    ? {
        title: createdEvent.title,
        allDay: createdEvent.allDay,
        ...createdSchedule!,
        calendarName: createdEvent.calendarName,
        location: createdEvent.location || "",
        description: createdEvent.description || "",
      }
    : {
        title: proposal.title,
        allDay: proposal.allDay,
        startDate: proposal.startDate,
        endDate: proposal.endDate,
        startTime: proposal.startTime,
        endTime: proposal.endTime,
        calendarName: proposal.source.kind === "resolved"
          ? proposal.source.calendarName
          : proposal.source.requestedCalendarName
            ? `Calendar unavailable (requested: ${proposal.source.requestedCalendarName})`
            : "Calendar unavailable",
        location: proposal.location,
        description: proposal.description,
      };
  const longDescription = display.description.length > 120;
  const StatusIcon = status === "created" ? Check : status === "superseded" ? Clock3 : CalendarDays;
  const statusLabel = status === "created" ? "Created" : status === "superseded" ? "Superseded" : "Proposed event";

  async function review(): Promise<void> {
    if (reviewing || status !== "proposed") return;
    setReviewing(true);
    await onReview().catch(() => false);
    setReviewing(false);
  }

  return (
    <section
      aria-label={`${statusLabel}: ${display.title}`}
      data-alfred-message-kind="calendar-proposal"
      data-proposal-status={status}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 12,
        borderRadius: 12,
        border: `1px solid ${status === "created" ? "color-mix(in srgb, var(--sp-green) 24%, transparent)" : "rgba(255,255,255,0.08)"}`,
        background: status === "superseded" ? "rgba(255,255,255,0.018)" : "rgba(36,36,58,0.46)",
        opacity: status === "superseded" ? 0.68 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: status === "created" ? "var(--sp-green)" : "var(--color-text-faint)", fontSize: 9.5, fontWeight: 650, letterSpacing: 1.2, textTransform: "uppercase" }}>
        <StatusIcon size={11} aria-hidden="true" />
        <span>{statusLabel}</span>
        {editedInCalendar ? <span style={{ marginLeft: "auto", color: "var(--sp-blue)", letterSpacing: 0, textTransform: "none", fontWeight: 550 }}>Edited in Calendar</span> : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 13, lineHeight: 1.45, fontWeight: 650, color: "var(--sp-text)" }}>
          <span>{scheduleLabel(display)}</span>
          {proposal.past && status !== "created" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--sp-cream)", fontSize: 10.5, fontWeight: 550 }}>
              <TriangleAlert size={11} aria-hidden="true" />
              Past date
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.45, fontWeight: 550, color: "rgba(205,214,244,0.88)" }}>
          {display.title}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 10.5, lineHeight: 1.45, color: "rgba(205,214,244,0.62)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CalendarDays size={11} aria-hidden="true" />
          <span>{display.calendarName}</span>
        </div>
        {display.location ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <MapPin size={11} aria-hidden="true" />
            <span>{display.location}</span>
          </div>
        ) : null}
        {proposal.duplicateCheckUnavailable && status !== "created" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertCircle size={11} aria-hidden="true" />
            <span>Duplicate check unavailable</span>
          </div>
        ) : null}
      </div>

      {display.description ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <AnimatedHeight>
            <div style={{
              fontSize: 10.5,
              lineHeight: 1.5,
              color: "rgba(205,214,244,0.62)",
              ...(!detailsOpen ? {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              } : {}),
            }}>
              {display.description}
            </div>
          </AnimatedHeight>
          {longDescription ? (
            <button
              type="button"
              onClick={() => setDetailsOpen((value) => !value)}
              aria-expanded={detailsOpen}
              className="transition-[background-color,color,transform] duration-150 motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transition-none motion-reduce:transform-none"
              style={{ display: "inline-flex", alignItems: "center", alignSelf: "flex-start", gap: 4, padding: "3px 5px", border: "none", borderRadius: 6, background: "transparent", color: "rgba(205,214,244,0.68)", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}
            >
              {detailsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {detailsOpen ? "Hide details" : "View details"}
            </button>
          ) : null}
        </div>
      ) : null}

      {handoffError && status === "proposed" ? (
        <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "var(--sp-rose)", fontSize: 10.5, lineHeight: 1.45 }}>
          <AlertCircle size={11} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>{handoffError}</span>
        </div>
      ) : null}

      {status !== "superseded" ? (
        <button
          type="button"
          disabled={reviewing}
          onClick={status === "created" ? onOpenEvent : () => { void review(); }}
          className="transition-[background-color,border-color,color,transform] duration-150 motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-wait disabled:opacity-55 disabled:transform-none motion-reduce:transition-none motion-reduce:transform-none"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            width: "100%",
            minHeight: 34,
            padding: "7px 10px",
            borderRadius: 9,
            border: `1px solid ${status === "created" ? "color-mix(in srgb, var(--sp-green) 26%, transparent)" : `${accent}55`}`,
            background: status === "created" ? "color-mix(in srgb, var(--sp-green) 8%, transparent)" : `${accent}18`,
            color: status === "created" ? "var(--sp-green)" : "var(--sp-text)",
            cursor: reviewing ? "wait" : "pointer",
            fontFamily: "inherit",
            fontSize: 11,
            fontWeight: 650,
          }}
        >
          {reviewing ? <RefreshCw size={12} className="alfred-context-spinner" /> : <CalendarDays size={12} />}
          {status === "created" ? "Open event" : handoffError ? "Try again" : reviewing ? "Opening Calendar…" : "Review in Calendar"}
        </button>
      ) : null}
    </section>
  );
}

export default memo(AlfredCalendarProposalCard);
