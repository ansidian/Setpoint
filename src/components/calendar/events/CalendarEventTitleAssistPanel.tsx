import type { CalendarTitleAssist } from "./calendarEventEditorModel";

interface CalendarEventTitleAssistPanelProps {
  show: boolean;
  titleAssist: CalendarTitleAssist;
}

export default function CalendarEventTitleAssistPanel({
  show,
  titleAssist,
}: CalendarEventTitleAssistPanelProps) {
  if (!show) return null;
  const showLocationAssist = !!titleAssist.locationQuery;
  const showSourceAssist = !!titleAssist.sourceQuery;
  if (!showLocationAssist && !showSourceAssist) return null;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.03)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {showLocationAssist ? (
        <div
          data-testid="calendar-event-title-location-preview"
          style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
        >
          Parsed location query: <span style={{ color: "#f5c2e7" }}>{titleAssist.locationQuery}</span>
        </div>
      ) : null}
      {showSourceAssist ? (
        <div
          data-testid="calendar-event-title-source-preview"
          style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
        >
          Parsed calendar source: <span style={{ color: "var(--sp-cyan)" }}>{titleAssist.sourceQuery}</span>
        </div>
      ) : null}
    </div>
  );
}
