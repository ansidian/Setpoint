import { Bell, Clock3, MapPin, Repeat2, Users } from "lucide-react";
import { motion as Motion } from "motion/react";
import type { Transition } from "motion/react";
import type { ReactNode } from "react";
import GoogleSpecialDateBadge from "../../GoogleSpecialDateBadge.tsx";
import { RailHeroCard, RailMetaChip, RailReminderIndicator } from "../../DetailRailPrimitives.tsx";
import { useDetailRailMotion } from "../../detailRailMotion.ts";
import { getLocationDisplayLabel } from "../../../../lib/calendar-links";
import { formatReminderSummary } from "../../reminderDisplay.ts";
import { isGoogleSpecialDateEvent } from "../../googleSpecialDateModel.ts";
import { compactEventTimeRange, eventMeta, isEditableEvent, specialEventLabel } from "./eventDetailModel.ts";
import type { CalendarItemLike } from "../calendarViewTypes";

export default function EventSelectedCard({ ev, actions, accent = "#89b4fa" }: { ev: CalendarItemLike; actions?: ReactNode; accent?: string }) {
  const motion = useDetailRailMotion();
  const layoutTransition = motion.layout as Transition;
  const specialDate = isGoogleSpecialDateEvent(ev);
  const editable = isEditableEvent(ev);
  const location = ev.location ? getLocationDisplayLabel(ev.location) : null;
  const attendeeSummary = ev.attendees?.length ? `${ev.attendees.length} attendee${ev.attendees.length === 1 ? "" : "s"}` : null;
  const accessoryLabel = specialDate ? null : location || attendeeSummary;
  const AccessoryIcon = location ? MapPin : Users;
  const durationLabel = !ev.allDay && !specialDate ? eventMeta(ev) : null;
  const reminderSummary = specialDate ? "" : formatReminderSummary(ev);
  const typeLabel = specialEventLabel(ev);
  const showRecurring = ev.isRecurring && !typeLabel && !specialDate;

  return (
    <Motion.div layout transition={layoutTransition} data-testid="calendar-selected-event-card"
      data-density="compressed" data-height-mode="auto" style={{ flexShrink: 0 }}>
      <RailHeroCard accent={accent} compact actions={actions}>
        <div style={specialDate ? { display: "flex", alignItems: "center", gap: 8 } : undefined}>
          {specialDate ? <GoogleSpecialDateBadge item={ev} color={accent} selected variant="detail" /> : null}
          <h3 className="calendar-detail-title" data-testid="calendar-selected-event-title">{String(ev.title || "").trim() || "(No title)"}</h3>
        </div>
        {!specialDate ? <div className="detail-card-time" data-testid="calendar-selected-event-time">{compactEventTimeRange(ev)}</div> : null}
        {accessoryLabel ? <div className="detail-card-location"><AccessoryIcon size={13} aria-hidden="true" /><span className="calendar-detail-location">{accessoryLabel}</span></div> : null}
        {(durationLabel || ev.allDay || typeLabel || showRecurring || !editable || reminderSummary) ? (
          <div className="detail-card-meta">
            {durationLabel ? <RailMetaChip compact><Clock3 size={13} aria-hidden="true" />{durationLabel}</RailMetaChip> : null}
            {reminderSummary ? <RailReminderIndicator compact><Bell size={11} aria-hidden="true" />{reminderSummary}</RailReminderIndicator> : null}
            {typeLabel ? <RailMetaChip compact>{typeLabel}</RailMetaChip> : null}
            {ev.allDay && !specialDate ? <RailMetaChip compact>All day</RailMetaChip> : null}
            {showRecurring ? <RailMetaChip compact><Repeat2 size={13} aria-hidden="true" />Recurring</RailMetaChip> : null}
            {!editable ? <RailMetaChip compact>Read-only</RailMetaChip> : null}
          </div>
        ) : null}
      </RailHeroCard>
    </Motion.div>
  );
}
