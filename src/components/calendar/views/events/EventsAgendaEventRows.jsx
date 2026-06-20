import { Bell, Video } from "lucide-react";
import { extractZoomMeetingUrl, getLocationDisplayLabel } from "../../../../lib/calendar-links.js";
import GoogleSpecialDateBadge from "../../GoogleSpecialDateBadge.jsx";
import {
  googleSpecialDateAccent,
  isGoogleSpecialDateEvent,
} from "../../googleSpecialDateModel.js";
import { colorWithAlpha, contrastText } from "./eventsAgendaColor.js";
import { formatReminderSummary } from "../../reminderDisplay.js";

function agendaEventMatchItemIds(event) {
  return [
    event?.agendaItemId,
    event?.id,
    event?.iCalUID,
    event?.htmlLink,
    event?.openUrl,
  ].filter(Boolean).map(String).join(" ");
}

function isPastTimedEventToday(event, dateKey, todayKey) {
  return dateKey === todayKey && Number.isFinite(event?.endMs) && event.endMs < Date.now();
}

function isEventSelectionModifier(event) {
  return !!(event?.metaKey || event?.ctrlKey);
}

export function AllDayChip({
  event,
  selected,
  onSelect,
  quickActions,
  onDirtyBlocked,
  onPreviewStart,
  onPreviewEnd,
}) {
  const specialDate = isGoogleSpecialDateEvent(event);
  const color = specialDate ? googleSpecialDateAccent(event) : event.agendaSourceColor;
  const safeText = contrastText(color);
  const solid = !specialDate && safeText === "#16161e";
  const dragAllowed = !!quickActions?.dragEnabled && !!event.writable && !specialDate;
  const reminderSummary = formatReminderSummary(event);
  const batchSelected = !specialDate && !!quickActions?.isEventSelectionSelected?.(event);
  return (
    <button
      type="button"
      data-testid="calendar-agenda-event-chip"
      data-item-id={event.agendaItemId}
      data-calendar-match-item-ids={agendaEventMatchItemIds(event)}
      data-calendar-event-selection={batchSelected ? "true" : undefined}
      data-calendar-event-activation="true"
      draggable={dragAllowed}
      onDragStart={(dragEvent) => {
        if (!dragAllowed) return;
        if (onDirtyBlocked?.()) {
          dragEvent.preventDefault();
          return;
        }
        if (!quickActions?.beginDrag?.(event)) {
          dragEvent.preventDefault();
          return;
        }
        dragEvent.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => quickActions?.endDrag?.()}
      onContextMenu={(contextEvent) => {
        if (!event.writable) return;
        contextEvent.preventDefault();
        contextEvent.stopPropagation();
        quickActions?.openContextMenu?.({ event, x: contextEvent.clientX, y: contextEvent.clientY });
      }}
      onClick={(clickEvent) => {
        if (isEventSelectionModifier(clickEvent)) {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          quickActions?.toggleEventSelection?.({
            event,
            dateKey: event.agendaDateKey,
            anchorElement: clickEvent.currentTarget,
            sourceCellElement: clickEvent.currentTarget,
            anchorKind: "agenda-chip",
          });
          return;
        }
        onSelect(event, clickEvent.currentTarget, "agenda-chip");
      }}
      style={{
        minWidth: 0,
        maxWidth: "100%",
        display: specialDate ? "grid" : "inline-flex",
        gridTemplateColumns: specialDate ? "24px minmax(0, 1fr)" : undefined,
        alignItems: "center",
        gap: specialDate ? 7 : 6,
        minHeight: specialDate ? 36 : 24,
        padding: specialDate ? "5px 9px 5px 7px" : "4px 8px",
        borderRadius: specialDate ? 9 : 7,
        border: batchSelected
          ? `1px solid ${colorWithAlpha(color, 0.94)}`
          : selected
            ? `1px solid ${colorWithAlpha(color, specialDate ? 0.58 : 1)}`
            : `1px solid ${colorWithAlpha(color, specialDate ? 0.24 : solid ? 0.5 : 0.72)}`,
        background: batchSelected
          ? `linear-gradient(180deg, ${colorWithAlpha(color, 0.34)}, ${colorWithAlpha(color, 0.16)})`
          : specialDate
            ? selected
              ? `linear-gradient(180deg, ${colorWithAlpha(color, 0.18)}, ${colorWithAlpha(color, 0.08)})`
              : colorWithAlpha(color, 0.08)
            : selected
              ? colorWithAlpha(color, 0.28)
              : solid
                ? color
                : colorWithAlpha(color, 0.14),
        color: solid && !selected && !batchSelected ? safeText : "#e9e7f6",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.15,
        cursor: "pointer",
        transition: "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(-1px)";
        onPreviewStart?.(event);
      }}
      onMouseLeave={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(0)";
        onPreviewEnd?.(event);
      }}
      onFocus={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(-1px)";
        onPreviewStart?.(event);
      }}
      onBlur={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(0)";
        onPreviewEnd?.(event);
      }}
    >
      {specialDate ? (
        <GoogleSpecialDateBadge
          item={event}
          color={color}
          selected={selected}
          variant="agenda"
        />
      ) : !solid ? (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 }}
        />
      ) : null}
      <span style={{
        minWidth: 0,
        overflow: "hidden",
        textOverflow: specialDate ? "clip" : "ellipsis",
        whiteSpace: specialDate ? "normal" : "nowrap",
        display: specialDate ? "-webkit-box" : "block",
        WebkitLineClamp: specialDate ? 2 : undefined,
        WebkitBoxOrient: specialDate ? "vertical" : undefined,
      }}>
        {event.agendaTitle}
      </span>
      {reminderSummary ? (
        <span data-testid="calendar-agenda-reminder-label" aria-label={reminderSummary} style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0, color: "var(--sp-cream)", fontSize: 10 }}>
          <Bell size={10} aria-hidden />
          {reminderSummary.replace(/^Reminder\s+/, "")}
        </span>
      ) : null}
    </button>
  );
}

export function TimedRow({
  event,
  dateKey,
  todayKey,
  selected,
  onSelect,
  quickActions,
  onDirtyBlocked,
  onPreviewStart,
  onPreviewEnd,
}) {
  const color = event.agendaSourceColor;
  const location = event.location ? getLocationDisplayLabel(event.location) : "";
  const hasVideo = !!extractZoomMeetingUrl(event);
  const past = isPastTimedEventToday(event, dateKey, todayKey);
  const dragAllowed = !!quickActions?.dragEnabled && !!event.writable;
  const reminderSummary = formatReminderSummary(event);
  const batchSelected = !!quickActions?.isEventSelectionSelected?.(event);
  return (
    <button
      type="button"
      data-testid="calendar-agenda-event-row"
      data-item-id={event.agendaItemId}
      data-calendar-match-item-ids={agendaEventMatchItemIds(event)}
      data-calendar-event-selection={batchSelected ? "true" : undefined}
      data-calendar-event-activation="true"
      draggable={dragAllowed}
      onDragStart={(dragEvent) => {
        if (!dragAllowed) return;
        if (onDirtyBlocked?.()) {
          dragEvent.preventDefault();
          return;
        }
        if (!quickActions?.beginDrag?.(event)) {
          dragEvent.preventDefault();
          return;
        }
        dragEvent.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => quickActions?.endDrag?.()}
      onContextMenu={(contextEvent) => {
        if (!event.writable) return;
        contextEvent.preventDefault();
        contextEvent.stopPropagation();
        quickActions?.openContextMenu?.({ event, x: contextEvent.clientX, y: contextEvent.clientY });
      }}
      onClick={(clickEvent) => {
        if (isEventSelectionModifier(clickEvent)) {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          quickActions?.toggleEventSelection?.({
            event,
            dateKey: event.agendaDateKey,
            anchorElement: clickEvent.currentTarget,
            sourceCellElement: clickEvent.currentTarget,
            anchorKind: "agenda-row",
          });
          return;
        }
        onSelect(event, clickEvent.currentTarget, "agenda-row");
      }}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "8px minmax(0, 1fr)",
        gridTemplateRows: "auto auto",
        alignItems: "start",
        columnGap: 8,
        rowGap: 4,
        padding: "8px 9px",
        borderRadius: 8,
        border: batchSelected
          ? `1px solid ${colorWithAlpha(color, 0.84)}`
          : selected ? `1px solid ${colorWithAlpha(color, 0.75)}` : "1px solid rgba(255,255,255,0.055)",
        background: batchSelected
          ? `linear-gradient(180deg, ${colorWithAlpha(color, 0.22)}, ${colorWithAlpha(color, 0.10)})`
          : selected ? colorWithAlpha(color, 0.18) : "rgba(255,255,255,0.025)",
        color: past ? "rgba(205,214,244,0.48)" : "var(--sp-text)",
        cursor: "pointer",
        textAlign: "left",
        transition: "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(-1px)";
        if (!selected) eventObject.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        onPreviewStart?.(event);
      }}
      onMouseLeave={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(0)";
        if (!selected) eventObject.currentTarget.style.borderColor = "rgba(255,255,255,0.055)";
        onPreviewEnd?.(event);
      }}
      onFocus={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(-1px)";
        if (!selected) eventObject.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        onPreviewStart?.(event);
      }}
      onBlur={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(0)";
        if (!selected) eventObject.currentTarget.style.borderColor = "rgba(255,255,255,0.055)";
        onPreviewEnd?.(event);
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          marginTop: 5,
          gridColumn: 1,
          gridRow: "1 / span 2",
          borderRadius: 999,
          background: color,
          boxShadow: selected || batchSelected ? `0 0 0 3px ${colorWithAlpha(color, batchSelected ? 0.22 : 0.16)}` : "none",
        }}
      />
      <span
        style={{
          color: past ? "rgba(166,173,200,0.75)" : "rgba(166,173,200,0.82)",
          fontSize: 10,
          fontWeight: 650,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.25,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
          gridColumn: 2,
          gridRow: 1,
          paddingTop: 1,
        }}
      >
        {event.agendaTimeRange}
      </span>
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3, gridColumn: 2, gridRow: 2 }}>
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            color: past ? "rgba(205,214,244,0.58)" : "#f1f2fb",
            fontSize: 12,
            fontWeight: 650,
            lineHeight: 1.25,
          }}
        >
          {hasVideo ? <Video size={12} strokeWidth={2} aria-label="Video meeting" style={{ display: "inline", marginRight: 5, verticalAlign: "-2px", color: "var(--sp-blue)" }} /> : null}
          {event.agendaTitle}
        </span>
        {location ? (
          <span
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              color: "rgba(166,173,200,0.75)",
              fontSize: 10.5,
              lineHeight: 1.3,
            }}
          >
            {location}
          </span>
        ) : null}
        {reminderSummary ? (
          <span data-testid="calendar-agenda-reminder-label" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--sp-cream)", fontSize: 10.5, lineHeight: 1.3 }}>
            <Bell size={11} aria-hidden />
            {reminderSummary}
          </span>
        ) : null}
      </span>
    </button>
  );
}
