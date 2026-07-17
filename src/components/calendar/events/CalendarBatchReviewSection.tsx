import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type RefObject,
} from "react";
import { CalendarDays, X, type LucideIcon } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarEventCompactSchedulePicker from "./CalendarEventCompactSchedulePicker";
import type { CalendarBatchDraft } from "./calendarEventEditorModel";
import type useCalendarEventEditor from "./useCalendarEventEditor";

type CalendarEventEditorController = ReturnType<typeof useCalendarEventEditor>;
type BatchScheduleField = "startDate" | "endDate" | "startTime" | "endTime" | "allDay";

interface PickerButtonProps {
  icon: LucideIcon;
  value: string;
  testId: string;
  disabled: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

interface BatchRowProps {
  item: CalendarBatchDraft;
  index: number;
  allDay: boolean;
  disabled: boolean;
  onUpdateDraft: CalendarEventEditorController["updateBatchDraft"];
  onRemoveDraft: CalendarEventEditorController["removeBatchDraft"];
}

interface CalendarBatchReviewSectionProps {
  batchDrafts: CalendarBatchDraft[];
  allDay: boolean;
  disabled: boolean;
  onUpdateDraft: CalendarEventEditorController["updateBatchDraft"];
  onRemoveDraft: CalendarEventEditorController["removeBatchDraft"];
}

const SCHEDULE_PICKER_WIDTH = 328;
const SCHEDULE_PICKER_HEIGHT = 540;
const ACCENT = "var(--ea-accent)";

function sectionCardStyle(): CSSProperties {
  return {
    marginTop: 8,
    padding: "10px 0 0",
    borderTop: "1px solid rgba(255,255,255,0.055)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };
}

function rowShellStyle(hasError: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(64px, 0.62fr) minmax(0, 1.6fr) auto",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    borderRadius: 8,
    border: hasError ? "1px solid color-mix(in srgb, var(--sp-rose) 18%, transparent)" : "1px solid rgba(255,255,255,0.045)",
    background: hasError
      ? "color-mix(in srgb, var(--sp-rose) 6%, transparent)"
      : "rgba(255,255,255,0.022)",
  };
}

function formatDate(value?: string) {
  if (!value) return "Choose date";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  });
}

function formatDateFull(value?: string) {
  if (!value) return "Choose date";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(value?: string) {
  if (!value) return "Choose time";
  return new Date(`2000-01-01T${value}:00`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatScheduleSummary(item: CalendarBatchDraft, allDay: boolean) {
  const dateLabel = item.startDate === item.endDate
    ? formatDateFull(item.startDate)
    : `${formatDateFull(item.startDate)} to ${formatDateFull(item.endDate)}`;
  if (allDay) return `${dateLabel} · All day`;
  return `${dateLabel} · ${formatTimeLabel(item.startTime)} to ${formatTimeLabel(item.endTime)}`;
}

function PickerButton({ icon: IconComponent, value, testId, disabled, anchorRef, onClick }: PickerButtonProps) {
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
        color: "var(--sp-text)",
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

function BatchRow({ item, index, allDay, disabled, onUpdateDraft, onRemoveDraft }: BatchRowProps) {
  const [openPicker, setOpenPicker] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scheduleRef = useRef<HTMLButtonElement | null>(null);

  const updateScheduleField = useCallback((field: BatchScheduleField, value: string | boolean) => {
    if (field === "allDay") return;
    onUpdateDraft(item.id || "", field, String(value));
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
        <div style={{ fontSize: 10.5, color: "var(--color-text-faint)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
            background: "color-mix(in srgb, var(--sp-rose) 8%, transparent)",
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
        onClick={() => onRemoveDraft(item.id || "")}
        disabled={disabled}
        aria-label={`Remove event ${index + 1}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 8,
          border: "1px solid color-mix(in srgb, var(--sp-rose) 18%, transparent)",
          background: "color-mix(in srgb, var(--sp-rose) 4%, transparent)",
          color: disabled ? "color-mix(in srgb, var(--sp-rose) 35%, transparent)" : "var(--sp-rose)",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 0,
          flexShrink: 0,
          transition: "background 140ms, border-color 140ms, transform 140ms",
        }}
        onMouseEnter={(event) => {
          if (!disabled) {
            event.currentTarget.style.background = "color-mix(in srgb, var(--sp-rose) 8%, transparent)";
            event.currentTarget.style.borderColor = "color-mix(in srgb, var(--sp-rose) 28%, transparent)";
            event.currentTarget.style.transform = "translateY(-1px)";
          }
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "color-mix(in srgb, var(--sp-rose) 4%, transparent)";
          event.currentTarget.style.borderColor = "color-mix(in srgb, var(--sp-rose) 18%, transparent)";
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
            draft={{
              startDate: item.startDate || "",
              endDate: item.endDate || "",
              startTime: item.startTime || "",
              endTime: item.endTime || "",
              allDay,
            }}
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
}: CalendarBatchReviewSectionProps) {
  return (
    <div data-testid="calendar-batch-review" data-density="compact" style={sectionCardStyle()}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(226,232,240,0.84)" }}>
          Batch Review
        </div>
        <div style={{ fontSize: 10.5, color: "var(--color-text-faint)", lineHeight: 1.4 }}>
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
