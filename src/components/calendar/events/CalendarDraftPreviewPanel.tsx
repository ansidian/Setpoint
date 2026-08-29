import {
  ghostDisplayRange,
  type CalendarConflictDetail,
  type CalendarScheduleContextItem,
} from "../ghostPreview.ts";
import { formatRecurrenceSummary, formatScheduleSummary, previewSegmentStyle } from "./calendarEditorUtils";
import type {
  CalendarEventDraft,
  CalendarRecurrenceDraft,
  WritableCalendarOption,
} from "./calendarEventEditorModel";

export interface CalendarDraftGhost {
  recurring?: boolean;
  conflicts?: CalendarConflictDetail[];
  scheduleContext?: CalendarScheduleContextItem[];
  title?: string;
  startDate?: string;
  endDate?: string;
  startMs?: number | null;
  endMs?: number | null;
  allDay?: boolean;
  color?: string;
  [key: string]: unknown;
}

export interface CalendarDraftGhostPreview {
  ghosts?: CalendarDraftGhost[];
  totalConflictCount?: number;
}

interface CalendarDraftPreviewPanelProps {
  ghostPreview?: CalendarDraftGhostPreview | null;
  draft?: Pick<CalendarEventDraft, "startDate" | "endDate" | "startTime" | "endTime" | "location"> | null;
  selectedSource?: {
    summary?: WritableCalendarOption["summary"];
    label?: WritableCalendarOption["label"];
    color?: WritableCalendarOption["color"];
  } | null;
  recurrenceDraft?: CalendarRecurrenceDraft | null;
  isRecurringEvent?: boolean;
  showDraftFallback?: boolean;
}

interface CalendarDraftPreviewSegment {
  kind: string;
  label: string;
  value: string;
  color: string;
}

export default function CalendarDraftPreviewPanel({
  ghostPreview,
  draft,
  selectedSource,
  recurrenceDraft,
  isRecurringEvent = false,
  showDraftFallback = false,
}: CalendarDraftPreviewPanelProps) {
  const ghosts = ghostPreview?.ghosts || [];
  const hasGhosts = ghosts.length > 0;
  if (!hasGhosts && !showDraftFallback) return null;
  const first = ghosts[0];
  const conflictCount = ghostPreview?.totalConflictCount || 0;
  const fallbackScheduleSummary = ghosts.length > 1
    ? `${ghosts.length} draft events`
    : hasGhosts
      ? ghostDisplayRange(first)
      : "No schedule";
  const scheduleSummary = ghosts.length > 1
    ? fallbackScheduleSummary
    : formatScheduleSummary(draft, fallbackScheduleSummary);
  const sourceSummary = selectedSource?.summary || selectedSource?.label || "No calendar";
  const locationSummary = draft?.location?.trim() || "No location";
  const recurrenceSummary = formatRecurrenceSummary(recurrenceDraft, draft?.startDate)
    || (isRecurringEvent ? "Recurring event" : "Does not repeat");
  const statusSummary = conflictCount
    ? `Overlaps ${conflictCount} event${conflictCount === 1 ? "" : "s"}`
    : first?.recurring
      ? "First occurrence shown"
      : null;
  const segments: CalendarDraftPreviewSegment[] = [
    {
      kind: "schedule",
      label: "Schedule",
      value: scheduleSummary,
      color: conflictCount ? "#f5c2e7" : "var(--sp-text)",
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
      color: draft?.location?.trim() ? "#f5c2e7" : "rgba(166,173,200,0.75)",
    },
    {
      kind: "repeat",
      label: "Repeat",
      value: recurrenceSummary,
      color: recurrenceDraft || isRecurringEvent ? "var(--sp-green)" : "rgba(166,173,200,0.75)",
    },
    statusSummary
      ? {
          kind: conflictCount ? "conflict" : "status",
          label: conflictCount ? "Conflict" : "Status",
          value: statusSummary,
          color: conflictCount ? "#f5c2e7" : "var(--sp-cyan)",
        }
      : null,
  ].filter((segment): segment is CalendarDraftPreviewSegment => segment !== null);

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
            flex: "0 0 auto",
            gap: 7,
            minWidth: 0,
            maxWidth: "100%",
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
              ...previewSegmentStyle(segment.kind),
              color: segment.color,
            }}
          >
            {segment.value}
          </span>
        </span>
      ))}
    </div>
  );
}
