import { CheckCircle2, ListChecks, Plus } from "lucide-react";
import { useState } from "react";

export default function EventsHeaderExtras({ editor, selectedDateLabel }) {
  const [hovered, setHovered] = useState(null);

  if (!editor?.editable) return null;
  const label = selectedDateLabel ? `New event on ${selectedDateLabel}` : "New event";
  const overlay = editor.deadlineOverlay;
  const overlayVisible = !!overlay?.enabled;
  const completedVisible = !!overlay?.showCompleted;
  const readiness = overlay?.readiness || {};
  const statusLabel = readiness.state === "slow" && readiness.slowSource
    ? `${readiness.slowSource === "deadlines" ? "Deadlines" : "Events"} slow`
    : readiness.deadlinesDelayed
      ? "Deadlines delayed"
      : null;
  const toggleStyle = (active, key, disabled = false) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 8,
    border: active ? "1px solid rgba(203,166,218,0.30)" : "1px solid rgba(255,255,255,0.06)",
    background: active ? "rgba(203,166,218,0.13)" : hovered === key && !disabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
    color: disabled ? "rgba(205,214,244,0.24)" : active ? "#cba6da" : "rgba(205,214,244,0.64)",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    transform: hovered === key && !disabled ? "translateY(-1px)" : "translateY(0)",
    transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms",
  });
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {overlay ? (
        <>
          <button
            type="button"
            onClick={overlay.onToggle}
            aria-label={overlayVisible ? "Hide deadlines in Events" : "Show deadlines in Events"}
            aria-pressed={overlayVisible}
            title={overlayVisible ? "Hide deadlines" : "Show deadlines"}
            data-calendar-focus-ring="true"
            onMouseEnter={() => setHovered("deadlines")}
            onMouseLeave={() => setHovered(null)}
            style={toggleStyle(overlayVisible, "deadlines")}
          >
            <ListChecks size={14} />
          </button>
          <button
            type="button"
            onClick={overlay.onToggleCompleted}
            aria-label={completedVisible ? "Hide completed deadlines" : "Show completed deadlines"}
            aria-pressed={completedVisible}
            aria-disabled={!overlayVisible}
            disabled={!overlayVisible}
            title={completedVisible ? "Hide completed deadlines" : "Show completed deadlines"}
            data-calendar-focus-ring="true"
            onMouseEnter={() => setHovered("completed")}
            onMouseLeave={() => setHovered(null)}
            style={toggleStyle(completedVisible, "completed", !overlayVisible)}
          >
            <CheckCircle2 size={14} />
          </button>
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
                border: hovered === "apply" ? "1px solid rgba(137,180,250,0.34)" : "1px solid rgba(137,180,250,0.20)",
                background: hovered === "apply" ? "rgba(137,180,250,0.14)" : "rgba(137,180,250,0.08)",
                color: "#89b4fa",
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
                border: "1px solid rgba(249,226,175,0.16)",
                background: "rgba(249,226,175,0.06)",
                color: "rgba(249,226,175,0.82)",
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
          border: hovered === "new" ? "1px solid rgba(203,166,218,0.34)" : "1px solid rgba(203,166,218,0.22)",
          background: hovered === "new" ? "rgba(203,166,218,0.18)" : "rgba(203,166,218,0.12)",
          color: "#cba6da",
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
    </div>
  );
}
