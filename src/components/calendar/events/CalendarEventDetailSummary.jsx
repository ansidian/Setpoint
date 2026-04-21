import { CalendarDays, ChevronDown, ChevronRight, Clock3, MapPin, Repeat, StickyNote } from "lucide-react";
import { formatDateLabel, formatTimeLabel } from "./calendarEditorUtils";

function DetailSummaryChip({ icon: Icon, label }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        fontSize: 11,
        color: "rgba(205,214,244,0.72)",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={10} style={{ color: "rgba(205,214,244,0.45)", flexShrink: 0 }} />
      {label}
    </span>
  );
}

export default function DetailSummaryRow({ draft, recurrenceSummary, onToggle, expanded }) {
  const dateLabel = draft.startDate === draft.endDate
    ? formatDateLabel(draft.startDate)
    : `${formatDateLabel(draft.startDate)} – ${formatDateLabel(draft.endDate)}`;
  const timeLabel = draft.allDay
    ? "All day"
    : `${formatTimeLabel(draft.startTime)} – ${formatTimeLabel(draft.endTime)}`;
  const hasLocation = !!draft.location?.trim();
  const hasNotes = !!draft.description?.trim();
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="calendar-event-detail-toggle"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.02)",
        cursor: "pointer",
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        fontFamily: "inherit",
        transition: "background 140ms",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "rgba(255,255,255,0.02)";
      }}
    >
      <Chevron size={12} style={{ color: "rgba(205,214,244,0.45)", flexShrink: 0 }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 0 }}>
        <DetailSummaryChip icon={CalendarDays} label={dateLabel} />
        <DetailSummaryChip icon={Clock3} label={timeLabel} />
        {recurrenceSummary ? <DetailSummaryChip icon={Repeat} label={recurrenceSummary} /> : null}
        {hasLocation ? <DetailSummaryChip icon={MapPin} label={draft.location.length > 20 ? `${draft.location.slice(0, 20)}…` : draft.location} /> : null}
        {hasNotes ? <DetailSummaryChip icon={StickyNote} label="Notes" /> : null}
      </div>
      <span style={{ fontSize: 10, color: "rgba(205,214,244,0.38)", flexShrink: 0 }}>
        {expanded ? "Collapse" : "Edit"}
      </span>
    </button>
  );
}
