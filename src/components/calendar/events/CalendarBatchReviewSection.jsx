import { useCallback, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarEventCompactSchedulePicker from "./CalendarEventCompactSchedulePicker";

const SCHEDULE_PICKER_WIDTH = 328;
const SCHEDULE_PICKER_HEIGHT = 540;
const ACCENT = "var(--ea-accent)";

function sectionCardStyle() {
  return {
    marginTop: 8,
    padding: "10px 0 0",
    borderTop: "1px solid rgba(255,255,255,0.055)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };
}

function rowShellStyle(hasError) {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(64px, 0.62fr) minmax(0, 1.6fr) auto",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    borderRadius: 8,
    border: hasError ? "1px solid rgba(243,139,168,0.18)" : "1px solid rgba(255,255,255,0.045)",
    background: hasError
      ? "rgba(243,139,168,0.055)"
      : "rgba(255,255,255,0.022)",
  };
}

function formatDate(value) {
  if (!value) return "Choose date";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  });
}

function formatDateFull(value) {
  if (!value) return "Choose date";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(value) {
  if (!value) return "Choose time";
  return new Date(`2000-01-01T${value}:00`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatScheduleSummary(item, allDay) {
  const dateLabel = item.startDate === item.endDate
    ? formatDateFull(item.startDate)
    : `${formatDateFull(item.startDate)} to ${formatDateFull(item.endDate)}`;
  if (allDay) return `${dateLabel} · All day`;
  return `${dateLabel} · ${formatTimeLabel(item.startTime)} to ${formatTimeLabel(item.endTime)}`;
}

// eslint-disable-next-line no-unused-vars -- Dynamic icon component is rendered in JSX below.
function PickerButton({ icon: IconComponent, value, testId, disabled, anchorRef, onClick }) {
  return (
    <button
      ref={anchorRef}
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      aria-label={value}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 9px",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.024)",
        color: "#cdd6f4",
        fontSize: 11,
        fontWeight: 650,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        transition: "transform 140ms, background 140ms",
      }}
      onMouseEnter={(event) => {
        if (!disabled) {
          event.currentTarget.style.background = "rgba(255,255,255,0.04)";
          event.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "rgba(255,255,255,0.024)";
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <IconComponent size={11} style={{ color: "rgba(205,214,244,0.45)", flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </button>
  );
}

function BatchRow({ item, index, allDay, disabled, onUpdateDraft, onRemoveDraft }) {
  const [openPicker, setOpenPicker] = useState(false);
  const panelRef = useRef(null);
  const scheduleRef = useRef(null);

  const updateScheduleField = useCallback((field, value) => {
    if (field === "allDay") return;
    onUpdateDraft(item.id, field, value);
  }, [item.id, onUpdateDraft]);

  const hasError = !!item.error;
  const scheduleLabel = formatScheduleSummary(item, allDay);

  return (
    <div
      data-testid={`calendar-batch-row-${index}`}
      data-density="compact"
      style={rowShellStyle(hasError)}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 650, color: "#e2e8f0", lineHeight: 1.2 }}>
          Event {index + 1}
        </div>
        <div style={{ fontSize: 10.5, color: "rgba(205,214,244,0.48)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {formatDate(item.startDate)}
        </div>
      </div>

      {hasError ? (
        <div
          data-testid={`calendar-batch-error-${index}`}
          style={{
            gridColumn: "1 / -1",
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(243,139,168,0.08)",
            color: "#f5c2e7",
            fontSize: 10.5,
            lineHeight: 1.4,
          }}
        >
          {item.error}
        </div>
      ) : null}

      <PickerButton
        icon={CalendarDays}
        value={scheduleLabel}
        testId={`calendar-batch-schedule-trigger-${index}`}
        disabled={disabled}
        anchorRef={scheduleRef}
        onClick={() => !disabled && setOpenPicker(true)}
      />

      <button
        type="button"
        data-testid={`calendar-batch-remove-${index}`}
        onClick={() => onRemoveDraft(item.id)}
        disabled={disabled}
        aria-label={`Remove event ${index + 1}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 8,
          border: "1px solid rgba(243,139,168,0.18)",
          background: "rgba(243,139,168,0.04)",
          color: disabled ? "rgba(243,139,168,0.35)" : "#f38ba8",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 0,
          flexShrink: 0,
          transition: "background 140ms, border-color 140ms, transform 140ms",
        }}
        onMouseEnter={(event) => {
          if (!disabled) {
            event.currentTarget.style.background = "rgba(243,139,168,0.08)";
            event.currentTarget.style.borderColor = "rgba(243,139,168,0.28)";
            event.currentTarget.style.transform = "translateY(-1px)";
          }
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "rgba(243,139,168,0.04)";
          event.currentTarget.style.borderColor = "rgba(243,139,168,0.18)";
          event.currentTarget.style.transform = "translateY(0)";
        }}
      >
        <X size={12} />
      </button>

      {openPicker ? (
        <AnchoredFloatingPanel
          anchorRef={scheduleRef}
          panelRef={panelRef}
          ariaLabel={`Batch event ${index + 1} schedule`}
          onClose={() => setOpenPicker(false)}
          width={SCHEDULE_PICKER_WIDTH}
          height={SCHEDULE_PICKER_HEIGHT}
          role="dialog"
          style={{ overflow: "hidden", padding: 10, zIndex: 10001 }}
        >
          <CalendarEventCompactSchedulePicker
            draft={{ ...item, allDay }}
            updateField={updateScheduleField}
            onClose={() => setOpenPicker(false)}
            showAllDayToggle={false}
          />
        </AnchoredFloatingPanel>
      ) : null}
    </div>
  );
}

export default function CalendarBatchReviewSection({
  batchDrafts,
  allDay,
  disabled,
  onUpdateDraft,
  onRemoveDraft,
}) {
  return (
    <div data-testid="calendar-batch-review" data-density="compact" style={sectionCardStyle()}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(226,232,240,0.84)" }}>
          Batch Review
        </div>
        <div style={{ fontSize: 10.5, color: "rgba(205,214,244,0.48)", lineHeight: 1.4 }}>
          These will be created as individual one-off events, not a recurring series.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {batchDrafts.map((item, index) => (
          <BatchRow
            key={item.id}
            item={item}
            index={index}
            allDay={allDay}
            disabled={disabled}
            onUpdateDraft={onUpdateDraft}
            onRemoveDraft={onRemoveDraft}
          />
        ))}
      </div>
    </div>
  );
}
