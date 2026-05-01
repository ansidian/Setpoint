import { forwardRef, useMemo, useRef, useState } from "react";
import { ChevronDown, Video } from "lucide-react";
import { extractZoomMeetingUrl, getLocationDisplayLabel } from "../../../../lib/calendar-links.js";
import { parseYmd, ymdFromParts } from "../../calendarDateUtils.js";
import AgendaRailShell from "../agenda/AgendaRailShell.jsx";
import { AgendaSkeleton, WeatherHeader } from "./EventsAgendaRailParts.jsx";
import { colorWithAlpha, contrastText } from "./eventsAgendaColor.js";
import { buildEventsAgendaGroups } from "./eventsAgendaModel.js";

const EVENT_SCROLL_TOP_OFFSET = 44;

function keyForEvent(event, dateKey) {
  return `${event.agendaItemId || event.id}-${dateKey}`;
}

function groupDate(group) {
  const parsed = parseYmd(group.dateKey);
  return parsed ? new Date(parsed.year, parsed.month, parsed.day) : null;
}

function isPastTimedEventToday(event, dateKey, todayKey) {
  return dateKey === todayKey && Number.isFinite(event?.endMs) && event.endMs < Date.now();
}

function AgendaHeader({
  group,
  todayKey,
  onActivate,
  registerHeader,
  dropActive,
  quickActions,
}) {
  const date = groupDate(group);
  return (
    <button
      type="button"
      ref={(node) => registerHeader(group.dateKey, node)}
      data-agenda-date-header="true"
      data-date-key={group.dateKey}
      aria-label={`Select ${date ? date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : group.dateKey}`}
      onClick={() => onActivate(group.dateKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(group.dateKey);
        }
      }}
      onDragEnter={() => quickActions?.enterDropTarget?.(group.dateKey)}
      onDragOver={(event) => {
        if (!quickActions?.draggingEventId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={() => quickActions?.leaveDropTarget?.(group.dateKey)}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 4,
        width: "calc(100% + 20px)",
        margin: "0 -10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        minHeight: 34,
        padding: "8px 10px 7px",
        border: "0",
        borderRadius: 0,
        background: dropActive
          ? "linear-gradient(180deg, rgba(203,166,218,0.16), rgba(203,166,218,0.08)), #1f1f24"
          : "#1f1f24",
        boxShadow: dropActive ? "inset 0 0 0 1px rgba(203,166,218,0.24)" : "none",
        color: group.dateKey === todayKey ? "#0495FF" : "#B1B1B3",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 1.35,
        lineHeight: 1,
        textAlign: "left",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "background-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = dropActive
          ? "linear-gradient(180deg, rgba(203,166,218,0.18), rgba(203,166,218,0.09)), #23232a"
          : "#23232a";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = dropActive
          ? "linear-gradient(180deg, rgba(203,166,218,0.16), rgba(203,166,218,0.08)), #1f1f24"
          : "#1f1f24";
      }}
    >
      <span>{group.headerLabel}</span>
      <WeatherHeader weather={group.weather} />
    </button>
  );
}

function AllDayChip({ event, selected, onSelect, quickActions, onDirtyBlocked }) {
  const color = event.agendaSourceColor;
  const safeText = contrastText(color);
  const solid = safeText === "#16161e";
  const dragAllowed = !!quickActions?.dragEnabled && !!event.writable;
  return (
    <button
      type="button"
      data-testid="calendar-agenda-event-chip"
      data-item-id={event.agendaItemId}
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
        quickActions?.openDeleteMenu?.({ event, x: contextEvent.clientX, y: contextEvent.clientY });
      }}
      onClick={(clickEvent) => onSelect(event, clickEvent.currentTarget, "agenda-chip")}
      style={{
        minWidth: 0,
        maxWidth: "100%",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 24,
        padding: "4px 8px",
        borderRadius: 7,
        border: selected ? `1px solid ${color}` : `1px solid ${colorWithAlpha(color, solid ? 0.5 : 0.72)}`,
        background: selected
          ? colorWithAlpha(color, 0.28)
          : solid
            ? color
            : colorWithAlpha(color, 0.14),
        color: solid && !selected ? safeText : "#e9e7f6",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.15,
        cursor: "pointer",
        transition: "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {!solid || selected ? (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 }}
        />
      ) : null}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {event.agendaTitle}
      </span>
    </button>
  );
}

function TimedRow({ event, dateKey, todayKey, selected, onSelect, quickActions, onDirtyBlocked }) {
  const color = event.agendaSourceColor;
  const location = event.location ? getLocationDisplayLabel(event.location) : "";
  const hasVideo = !!extractZoomMeetingUrl(event);
  const past = isPastTimedEventToday(event, dateKey, todayKey);
  const dragAllowed = !!quickActions?.dragEnabled && !!event.writable;
  return (
    <button
      type="button"
      data-testid="calendar-agenda-event-row"
      data-item-id={event.agendaItemId}
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
        quickActions?.openDeleteMenu?.({ event, x: contextEvent.clientX, y: contextEvent.clientY });
      }}
      onClick={(clickEvent) => onSelect(event, clickEvent.currentTarget, "agenda-row")}
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
        border: selected ? `1px solid ${colorWithAlpha(color, 0.75)}` : "1px solid rgba(255,255,255,0.055)",
        background: selected ? colorWithAlpha(color, 0.18) : "rgba(255,255,255,0.025)",
        color: past ? "rgba(205,214,244,0.48)" : "#cdd6f4",
        cursor: "pointer",
        textAlign: "left",
        transition: "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(-1px)";
        if (!selected) eventObject.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
      }}
      onMouseLeave={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(0)";
        if (!selected) eventObject.currentTarget.style.borderColor = "rgba(255,255,255,0.055)";
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
          boxShadow: selected ? `0 0 0 3px ${colorWithAlpha(color, 0.16)}` : "none",
        }}
      />
      <span
        style={{
          color: past ? "rgba(166,173,200,0.52)" : "rgba(166,173,200,0.82)",
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
          {hasVideo ? <Video size={12} strokeWidth={2} aria-label="Video meeting" style={{ display: "inline", marginRight: 5, verticalAlign: "-2px", color: "#89b4fa" }} /> : null}
          {event.agendaTitle}
        </span>
        {location ? (
          <span
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              color: "rgba(166,173,200,0.64)",
              fontSize: 10.5,
              lineHeight: 1.3,
            }}
          >
            {location}
          </span>
        ) : null}
      </span>
    </button>
  );
}

const EventsAgendaRail = forwardRef(function EventsAgendaRail({
  viewYear,
  viewMonth,
  events = [],
  weatherData = null,
  isLoading = false,
  selectedDateKey,
  selectedItemId,
  scrollCommand = null,
  currentYear,
  currentMonth,
  todayDate,
  eventQuickActions,
  floatingEditorDirty = false,
  onDirtyBlocked,
  onPassiveDateChange,
  onDateAction,
  onEventAction,
}, ref) {
  const todayKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const dragEventRef = useRef(null);
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  const agenda = useMemo(() => buildEventsAgendaGroups({
    events,
    viewYear,
    viewMonth,
    weatherData,
    todayKey,
    forceVisibleDateKey: selectedDateKey,
  }), [events, selectedDateKey, todayKey, viewMonth, viewYear, weatherData]);

  const dirtyBlocked = () => {
    if (!floatingEditorDirty) return false;
    onDirtyBlocked?.();
    return true;
  };

  function handleDateAction(dateKey) {
    if (dirtyBlocked()) return;
    onDateAction?.(dateKey);
  }

  function handleEventSelect(event, element, anchorKind) {
    if (dirtyBlocked()) return;
    onEventAction?.({
      event,
      dateKey: event.agendaDateKey,
      anchorElement: element,
      sourceCellElement: element,
      anchorKind,
    });
  }

  if (isLoading && !agenda.visibleGroups.some((group) => group.hasEvents)) {
    return <AgendaSkeleton />;
  }

  return (
    <AgendaRailShell
      ref={ref}
      testId="events-agenda-rail"
      groups={agenda.visibleGroups}
      firstVisibleDateKey={agenda.firstVisibleDateKey}
      todayKey={todayKey}
      selectedDateKey={selectedDateKey}
      scrollCommand={scrollCommand}
      isLoading={isLoading}
      floatingEditorDirty={floatingEditorDirty}
      itemScrollTopOffset={EVENT_SCROLL_TOP_OFFSET}
      onPassiveDateChange={onPassiveDateChange}
      onDirtyBlocked={onDirtyBlocked}
      skeleton={<AgendaSkeleton />}
      showSkeleton={isLoading && !agenda.visibleGroups.some((group) => group.hasEvents)}
      getSectionProps={(group) => ({
        onDragEnter: () => eventQuickActions?.enterDropTarget?.(group.dateKey),
        onDragOver: (event) => {
          if (!eventQuickActions?.draggingEventId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        },
        onDragLeave: () => eventQuickActions?.leaveDropTarget?.(group.dateKey),
        onDrop: (dropEvent) => {
          if (!eventQuickActions?.draggingEventId) return;
          dropEvent.preventDefault();
          eventQuickActions.dropEvent?.({
            event: dragEventRef.current,
            targetDate: group.dateKey,
            anchorRect: dropEvent.currentTarget.getBoundingClientRect(),
          });
        },
      })}
      renderHeader={({ group, registerHeader }) => (
        <AgendaHeader
          group={group}
          todayKey={todayKey}
          registerHeader={registerHeader}
          onActivate={handleDateAction}
          dropActive={eventQuickActions?.dropTargetDate === group.dateKey}
          quickActions={eventQuickActions}
        />
      )}
      renderGroup={({ group, registerRow, registerContent }) => {
        const expanded = expandedDays.has(group.dateKey);
        const visibleAllDay = expanded ? group.allDay : group.allDay.slice(0, 2);
        const hiddenAllDayCount = group.allDay.length - visibleAllDay.length;
        const showNoEvents = !group.hasEvents && (group.isFallback || selectedDateKey === group.dateKey);
        return (
          <>
            {group.allDay.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
                {visibleAllDay.map((event) => (
                  <span
                    key={keyForEvent(event, group.dateKey)}
                    ref={(node) => registerRow(keyForEvent(event, group.dateKey), node, group.dateKey)}
                    style={{ minWidth: 0, maxWidth: "100%" }}
                    onDragStart={() => {
                      dragEventRef.current = event;
                    }}
                  >
                    <AllDayChip
                      event={event}
                      selected={String(selectedItemId || "") === String(event.agendaItemId || "")}
                      onSelect={handleEventSelect}
                      quickActions={eventQuickActions}
                      onDirtyBlocked={dirtyBlocked}
                    />
                  </span>
                ))}
                {hiddenAllDayCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedDays((current) => {
                        const next = new Set(current);
                        next.add(group.dateKey);
                        return next;
                      });
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      minHeight: 24,
                      padding: "4px 8px",
                      borderRadius: 7,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.035)",
                      color: "rgba(205,214,244,0.74)",
                      fontSize: 11,
                      fontWeight: 750,
                      cursor: "pointer",
                    }}
                  >
                    +{hiddenAllDayCount}
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {group.timed.map((event) => (
              <span
                key={keyForEvent(event, group.dateKey)}
                ref={(node) => registerRow(keyForEvent(event, group.dateKey), node, group.dateKey)}
                onDragStart={() => {
                  dragEventRef.current = event;
                }}
              >
                <TimedRow
                  event={event}
                  dateKey={group.dateKey}
                  todayKey={todayKey}
                  selected={String(selectedItemId || "") === String(event.agendaItemId || "")}
                  onSelect={handleEventSelect}
                  quickActions={eventQuickActions}
                  onDirtyBlocked={dirtyBlocked}
                />
              </span>
            ))}
            {showNoEvents ? (
              <div
                ref={(node) => registerContent(group.dateKey, node)}
                style={{
                  padding: "12px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.055)",
                  background: "rgba(255,255,255,0.025)",
                  color: "rgba(205,214,244,0.64)",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 650, color: "rgba(205,214,244,0.82)" }}>No Events</div>
              </div>
            ) : null}
          </>
        );
      }}
    />
  );
});

export default EventsAgendaRail;
