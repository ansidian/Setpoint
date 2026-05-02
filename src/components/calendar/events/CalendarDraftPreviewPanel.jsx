import { ghostDisplayRange } from "../ghostPreview.js";
import { formatDateLabel, formatRecurrenceSummary, formatTimeLabel } from "./calendarEditorUtils";

function formatScheduleSummary(draft, fallback) {
  if (!draft?.startDate) return fallback;
  const dateLabel = draft.endDate && draft.endDate !== draft.startDate
    ? `${formatDateLabel(draft.startDate)} to ${formatDateLabel(draft.endDate)}`
    : formatDateLabel(draft.startDate);
  if (draft.allDay) return `${dateLabel} · All day`;
  if (draft.startTime && draft.endTime) {
    return `${dateLabel} · ${formatTimeLabel(draft.startTime)} to ${formatTimeLabel(draft.endTime)}`;
  }
  return `${dateLabel} · ${formatTimeLabel(draft.startTime)}`;
}

export default function CalendarDraftPreviewPanel({
  ghostPreview,
  draft,
  selectedSource,
  recurrenceDraft,
}) {
  const ghosts = ghostPreview?.ghosts || [];
  if (!ghosts.length) return null;
  const first = ghosts[0];
  const conflictCount = ghostPreview.totalConflictCount || 0;
  const fallbackScheduleSummary = ghosts.length > 1
    ? `${ghosts.length} draft events`
    : ghostDisplayRange(first);
  const scheduleSummary = ghosts.length > 1
    ? fallbackScheduleSummary
    : formatScheduleSummary(draft, fallbackScheduleSummary);
  const sourceSummary = selectedSource?.summary || selectedSource?.label || "No calendar";
  const locationSummary = draft?.location?.trim() || "No location";
  const recurrenceSummary = formatRecurrenceSummary(recurrenceDraft, draft?.startDate) || "Does not repeat";
  const statusSummary = conflictCount
    ? `Overlaps ${conflictCount} event${conflictCount === 1 ? "" : "s"}`
    : first.recurring
      ? "First occurrence shown"
      : null;
  const segments = [
    {
      kind: "schedule",
      label: "Schedule",
      value: scheduleSummary,
      color: conflictCount ? "#f5c2e7" : "#cdd6f4",
    },
    {
      kind: "source",
      label: "Calendar",
      value: sourceSummary,
      color: selectedSource?.color || "#89b4fa",
    },
    {
      kind: "location",
      label: "Location",
      value: locationSummary,
      color: draft?.location?.trim() ? "#f5c2e7" : "rgba(166,173,200,0.62)",
    },
    {
      kind: "repeat",
      label: "Repeat",
      value: recurrenceSummary,
      color: recurrenceDraft ? "#a6e3a1" : "rgba(166,173,200,0.62)",
    },
    statusSummary
      ? {
          kind: conflictCount ? "conflict" : "status",
          label: conflictCount ? "Conflict" : "Status",
          value: statusSummary,
          color: conflictCount ? "#f5c2e7" : "#89dceb",
        }
      : null,
  ].filter(Boolean);

  return (
    <div
      data-testid="calendar-draft-preview-summary"
      style={{
        minHeight: 26,
        padding: "2px 1px",
        display: "flex",
        alignItems: "center",
        gap: 7,
        flexWrap: "wrap",
        color: "rgba(205,214,244,0.58)",
        fontSize: 11,
        lineHeight: 1.4,
      }}
    >
      {segments.map((segment, index) => (
        <span
          key={`${segment.kind}-${segment.value}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            minWidth: 0,
          }}
        >
          {index > 0 ? (
            <span aria-hidden style={{ color: "rgba(205,214,244,0.24)" }}>/</span>
          ) : null}
          <span
            aria-label={`${segment.label}: ${segment.value}`}
            data-testid="calendar-draft-preview-segment"
            data-summary-kind={segment.kind}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 190,
              color: segment.color,
              fontWeight: segment.kind === "schedule" || segment.kind === "conflict" ? 600 : 500,
            }}
          >
            {segment.value}
          </span>
        </span>
      ))}
    </div>
  );
}
