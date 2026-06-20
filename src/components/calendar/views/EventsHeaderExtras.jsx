import { CalendarDays, CheckCircle2, ListChecks, Plus } from "lucide-react";
import { useState } from "react";
import Tooltip from "@/components/shared/Tooltip";

export default function EventsHeaderExtras({ editor, selectedDateLabel }) {
  const [hovered, setHovered] = useState(null);

  const label = selectedDateLabel ? `New event on ${selectedDateLabel}` : "New event";
  const eventOverlay = editor.eventOverlay;
  const eventsVisible = eventOverlay?.enabled !== false;
  const overlay = editor.deadlineOverlay;
  const overlayVisible = !!overlay?.enabled;
  const completedVisible = !!overlay?.showCompleted;
  const eventsTooltip = eventsVisible ? "Hide events" : "Show events";
  const deadlinesTooltip = overlayVisible ? "Hide deadlines" : "Show deadlines";
  const completedTooltip = completedVisible ? "Hide completed deadlines" : "Show completed deadlines";
  const readiness = overlay?.readiness || {};
  const statusLabel = readiness.state === "slow" && readiness.slowSource
    ? `${readiness.slowSource === "deadlines" ? "Deadlines" : "Events"} slow`
    : readiness.deadlinesDelayed
      ? "Deadlines delayed"
      : null;
  if (!overlay && !editor?.editable) return null;
  const toggleStyle = (active, key, disabled = false) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 8,
    border: active ? "1px solid color-mix(in srgb, var(--sp-accent) 30%, transparent)" : "1px solid rgba(255,255,255,0.06)",
    background: active ? "color-mix(in srgb, var(--sp-accent) 13%, transparent)" : hovered === key && !disabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
    color: disabled ? "rgba(205,214,244,0.24)" : active ? "var(--sp-accent)" : "rgba(205,214,244,0.64)",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    transform: hovered === key && !disabled ? "translateY(-1px)" : "translateY(0)",
    transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms",
  });
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {overlay ? (
        <>
          {eventOverlay ? (
            <Tooltip text={eventsTooltip} side="top" sideOffset={7} delay={350}>
              <button
                type="button"
                onClick={eventOverlay.onToggle}
                aria-label={eventsVisible ? "Hide events in Events" : "Show events in Events"}
                aria-pressed={eventsVisible}
                data-calendar-focus-ring="true"
                onMouseEnter={() => setHovered("events")}
                onMouseLeave={() => setHovered(null)}
                style={toggleStyle(eventsVisible, "events")}
              >
                <CalendarDays size={14} />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip text={deadlinesTooltip} side="top" sideOffset={7} delay={350}>
            <button
              type="button"
              onClick={overlay.onToggle}
              aria-label={overlayVisible ? "Hide deadlines in Events" : "Show deadlines in Events"}
              aria-pressed={overlayVisible}
              data-calendar-focus-ring="true"
              onMouseEnter={() => setHovered("deadlines")}
              onMouseLeave={() => setHovered(null)}
              style={toggleStyle(overlayVisible, "deadlines")}
            >
              <ListChecks size={14} />
            </button>
          </Tooltip>
          <Tooltip text={completedTooltip} side="top" sideOffset={7} delay={350}>
            <button
              type="button"
              onClick={overlay.onToggleCompleted}
              aria-label={completedVisible ? "Hide completed deadlines" : "Show completed deadlines"}
              aria-pressed={completedVisible}
              aria-disabled={!overlayVisible}
              disabled={!overlayVisible}
              data-calendar-focus-ring="true"
              onMouseEnter={() => setHovered("completed")}
              onMouseLeave={() => setHovered(null)}
              style={toggleStyle(completedVisible, "completed", !overlayVisible)}
            >
              <CheckCircle2 size={14} />
            </button>
          </Tooltip>
          {overlay.lateDeadlinesReady && overlay.onApplyLateDeadlines ? (
            <button
              type="button"
              onClick={overlay.onApplyLateDeadlines}
              data-testid="events-deadline-overlay-apply"
              data-calendar-focus-ring="true"
              onMouseEnter={() => setHovered("apply")}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                height: 36,
                padding: "0 10px",
                borderRadius: 8,
                border: hovered === "apply" ? "1px solid color-mix(in srgb, var(--sp-blue) 34%, transparent)" : "1px solid color-mix(in srgb, var(--sp-blue) 20%, transparent)",
                background: hovered === "apply" ? "color-mix(in srgb, var(--sp-blue) 14%, transparent)" : "color-mix(in srgb, var(--sp-blue) 8%, transparent)",
                color: "var(--sp-blue)",
                fontSize: 11,
                fontWeight: 650,
                cursor: "pointer",
                fontFamily: "inherit",
                transform: hovered === "apply" ? "translateY(-1px)" : "translateY(0)",
                transition: "transform 140ms, background 140ms, border-color 140ms",
              }}
            >
              Apply
            </button>
          ) : statusLabel ? (
            <span
              data-testid="events-deadline-overlay-status"
              role="status"
              aria-live="polite"
              title={statusLabel}
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 36,
                padding: "0 9px",
                borderRadius: 8,
                border: "1px solid color-mix(in srgb, var(--sp-cream) 16%, transparent)",
                background: "color-mix(in srgb, var(--sp-cream) 6%, transparent)",
                color: "color-mix(in srgb, var(--sp-cream) 82%, transparent)",
                fontSize: 10.5,
                fontWeight: 650,
                whiteSpace: "nowrap",
              }}
            >
              {statusLabel}
            </span>
          ) : null}
        </>
      ) : null}
      {editor?.editable ? (
        <button
          type="button"
          onClick={editor.openCreate}
          aria-label={label}
          data-calendar-focus-ring="true"
          onMouseEnter={() => setHovered("new")}
          onMouseLeave={() => setHovered(null)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 12px",
            height: 36,
            borderRadius: 8,
            border: hovered === "new" ? "1px solid color-mix(in srgb, var(--sp-accent) 34%, transparent)" : "1px solid color-mix(in srgb, var(--sp-accent) 22%, transparent)",
            background: hovered === "new" ? "color-mix(in srgb, var(--sp-accent) 18%, transparent)" : "color-mix(in srgb, var(--sp-accent) 12%, transparent)",
            color: "var(--sp-accent)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            transform: hovered === "new" ? "translateY(-1px)" : "translateY(0)",
            transition: "transform 140ms, background 140ms, border-color 140ms",
          }}
        >
          <Plus size={12} />
          New event
        </button>
      ) : null}
    </div>
  );
}
