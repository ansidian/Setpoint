import { Bell } from "lucide-react";
import { motion as Motion } from "motion/react";
import type { Transition } from "motion/react";
import type { ReactNode } from "react";
import GoogleSpecialDateBadge from "../../GoogleSpecialDateBadge.tsx";
import {
  RailHeroCard,
  RailMetaChip,
  RailReminderIndicator,
} from "../../DetailRailPrimitives.tsx";
import { useDetailRailMotion } from "../../detailRailMotion.ts";
import { getLocationDisplayLabel } from "../../../../lib/calendar-links";
import { formatReminderSummary } from "../../reminderDisplay.ts";
import { isGoogleSpecialDateEvent } from "../../googleSpecialDateModel.ts";
import {
  compactEventTimeRange,
  eventMeta,
  isEditableEvent,
  specialEventLabel,
} from "./eventDetailModel.ts";
import type { CalendarItemLike } from "../calendarViewTypes";

export default function EventSelectedCard({ ev, actions, accent = "#89b4fa" }: {
  ev: CalendarItemLike;
  actions?: ReactNode;
  accent?: string;
}) {
  const motion = useDetailRailMotion();
  const layoutTransition = motion.layout as Transition;
  const specialDate = isGoogleSpecialDateEvent(ev);
  const editable = isEditableEvent(ev);
  const displayTitle = String(ev.title || "").trim() || "(No title)";
  const location = ev.location ? getLocationDisplayLabel(ev.location) : null;
  const attendeeSummary = ev.attendees?.length
    ? `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}`
    : null;
  const durationLabel = !ev.allDay && !specialDate ? eventMeta(ev) : null;
  const accessoryLabel = specialDate ? null : location || attendeeSummary || null;
  const reminderSummary = specialDate ? "" : formatReminderSummary(ev);
  const typeLabel = specialEventLabel(ev);
  const showRecurring = ev.isRecurring && !typeLabel && !specialDate;

  return (
    <Motion.div
      layout
      transition={layoutTransition}
      data-testid="calendar-selected-event-card"
      data-density="compressed"
      data-height-mode="auto"
      style={{ flexShrink: 0 }}
    >
      <RailHeroCard accent={accent} compact actions={actions}>
        <Motion.div
          className="calendar-detail-eyebrow"
          layout
          transition={layoutTransition}
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "rgba(205,214,244,0.56)",
            flexShrink: 0,
          }}
        >
          Selected event
        </Motion.div>

        <Motion.div
          layout
          transition={layoutTransition}
          style={{
            display: specialDate ? "grid" : "flex",
            gridTemplateColumns: specialDate ? "32px minmax(0, 1fr)" : undefined,
            alignItems: specialDate ? "center" : undefined,
            flexDirection: specialDate ? undefined : "column",
            gap: specialDate ? 8 : 6,
            flexShrink: 0,
          }}
        >
          {specialDate ? (
            <GoogleSpecialDateBadge
              item={ev}
              color={accent}
              selected
              variant="detail"
            />
          ) : null}
          <Motion.div
            layout="position"
            transition={layoutTransition}
            className="calendar-detail-title" data-testid="calendar-selected-event-title"
            style={{
              fontSize: 17,
              lineHeight: 1.08,
              letterSpacing: -0.3,
              color: "#fff",
              fontWeight: 500,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {displayTitle}
          </Motion.div>
          {!specialDate ? (
            <Motion.div
              layout
              transition={layoutTransition}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                gap: "2px 8px",
              }}
            >
              <span
                data-testid="calendar-selected-event-time"
                data-nowrap="true"
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.35,
                  color: accent,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {compactEventTimeRange(ev)}
              </span>
              {accessoryLabel ? (
                <span className="calendar-detail-location"
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.4,
                    color: "rgba(205,214,244,0.56)",
                    display: "-webkit-box",
                    WebkitLineClamp: 1,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {accessoryLabel}
                </span>
              ) : null}
            </Motion.div>
          ) : null}
        </Motion.div>

        {(durationLabel || ev.allDay || typeLabel || showRecurring || !editable || reminderSummary) ? (
          <Motion.div layout transition={layoutTransition} style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {durationLabel ? <RailMetaChip tone="quiet" compact>{durationLabel}</RailMetaChip> : null}
            {reminderSummary ? (
              <RailReminderIndicator compact>
                <Bell size={10} strokeWidth={2.2} />
                {reminderSummary}
              </RailReminderIndicator>
            ) : null}
            {typeLabel ? <RailMetaChip tone="quiet" compact>{typeLabel}</RailMetaChip> : null}
            {ev.allDay && !specialDate ? <RailMetaChip tone="quiet" compact>All day</RailMetaChip> : null}
            {showRecurring ? <RailMetaChip tone="quiet" compact>Recurring</RailMetaChip> : null}
            {!editable ? <RailMetaChip tone="quiet" compact>Read-only</RailMetaChip> : null}
          </Motion.div>
        ) : null}
      </RailHeroCard>
    </Motion.div>
  );
}
