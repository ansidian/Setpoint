import { useCallback, useRef, useState } from "react";
import { CalendarDays, Clock3, X } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import TimePickerView from "@/components/shared/pickers/TimePickerView";

const DATE_PICKER_WIDTH = 300;
const DATE_PICKER_HEIGHT = 386;
const TIME_PICKER_WIDTH = 280;
const TIME_PICKER_HEIGHT = 238;
const ACCENT = "var(--ea-accent)";

function sectionCardStyle() {
  return {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.05)",
    background: "rgba(255,255,255,0.03)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };
}

function fieldLabelStyle() {
  return {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: "rgba(205,214,244,0.42)",
    marginBottom: 4,
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

function formatTime(value) {
  if (!value) return "—";
  return new Date(`2000-01-01T${value}:00`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function toPacificYmd(epoch) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epoch));
}

// eslint-disable-next-line no-unused-vars -- Icon is used in JSX below
function PickerButton({ icon: Icon, value, testId, disabled, anchorRef, onClick }) {
  return (
    <button
      ref={anchorRef}
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.03)",
        color: "#cdd6f4",
        fontSize: 11.5,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
        boxSizing: "border-box",
        transition: "transform 140ms, background 140ms",
      }}
      onMouseEnter={(event) => {
        if (!disabled) {
          event.currentTarget.style.background = "rgba(255,255,255,0.045)";
          event.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "rgba(255,255,255,0.03)";
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <Icon size={11} style={{ color: "rgba(205,214,244,0.45)", flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </button>
  );
}

function BatchRow({ item, index, allDay, disabled, onUpdateDraft, onRemoveDraft }) {
  const [openPicker, setOpenPicker] = useState(null);
  const panelRef = useRef(null);
  const startDateRef = useRef(null);
  const endDateRef = useRef(null);
  const startTimeRef = useRef(null);
  const endTimeRef = useRef(null);
  const [nowTick] = useState(() => Date.now());

  const sharedDatePickerProps = {
    panelRef,
    onClose: () => setOpenPicker(null),
    width: DATE_PICKER_WIDTH,
    height: DATE_PICKER_HEIGHT,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };
  const sharedTimePickerProps = {
    panelRef,
    onClose: () => setOpenPicker(null),
    width: TIME_PICKER_WIDTH,
    height: TIME_PICKER_HEIGHT,
    role: "dialog",
    style: { overflow: "hidden", padding: 8, zIndex: 10001 },
  };

  const handleStartDateSelect = useCallback((epoch) => {
    onUpdateDraft(item.id, "startDate", toPacificYmd(epoch));
    setOpenPicker("endDate");
  }, [item.id, onUpdateDraft]);

  const handleEndDateSelect = useCallback((epoch) => {
    onUpdateDraft(item.id, "endDate", toPacificYmd(epoch));
    setOpenPicker(allDay ? null : "startTime");
  }, [allDay, item.id, onUpdateDraft]);

  const handleStartTimeSelect = useCallback((value) => {
    onUpdateDraft(item.id, "startTime", value);
    setOpenPicker("endTime");
  }, [item.id, onUpdateDraft]);

  const handleEndTimeSelect = useCallback((value) => {
    onUpdateDraft(item.id, "endTime", value);
    setOpenPicker(null);
  }, [item.id, onUpdateDraft]);

  const hasError = !!item.error;

  return (
    <div
      data-testid={`calendar-batch-row-${index}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 8,
        border: hasError ? "1px solid rgba(243,139,168,0.18)" : "1px solid rgba(255,255,255,0.05)",
        background: hasError ? "rgba(243,139,168,0.04)" : "rgba(22,22,30,0.88)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "#e2e8f0" }}>
          Event {index + 1}
          <span style={{ fontWeight: 400, color: "rgba(205,214,244,0.48)", marginLeft: 8 }}>
            {formatDate(item.startDate)}
            {!allDay ? ` · ${formatTime(item.startTime)}–${formatTime(item.endTime)}` : ""}
          </span>
        </div>
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
            width: 22,
            height: 22,
            borderRadius: 6,
            border: "1px solid rgba(243,139,168,0.2)",
            background: "rgba(243,139,168,0.06)",
            color: disabled ? "rgba(243,139,168,0.35)" : "#f38ba8",
            cursor: disabled ? "not-allowed" : "pointer",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <X size={12} />
        </button>
      </div>

      {hasError ? (
        <div
          data-testid={`calendar-batch-error-${index}`}
          style={{
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div>
          <div style={fieldLabelStyle()}>Start</div>
          <PickerButton
            icon={CalendarDays}
            value={formatDate(item.startDate)}
            testId={`calendar-batch-start-date-${index}`}
            disabled={disabled}
            anchorRef={startDateRef}
            onClick={() => !disabled && setOpenPicker("startDate")}
          />
        </div>
        <div>
          <div style={fieldLabelStyle()}>End</div>
          <PickerButton
            icon={CalendarDays}
            value={formatDate(item.endDate)}
            testId={`calendar-batch-end-date-${index}`}
            disabled={disabled}
            anchorRef={endDateRef}
            onClick={() => !disabled && setOpenPicker("endDate")}
          />
        </div>
      </div>

      {!allDay ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div>
            <div style={fieldLabelStyle()}>Start time</div>
            <PickerButton
              icon={Clock3}
              value={formatTime(item.startTime)}
              testId={`calendar-batch-start-time-${index}`}
              disabled={disabled}
              anchorRef={startTimeRef}
              onClick={() => !disabled && setOpenPicker("startTime")}
            />
          </div>
          <div>
            <div style={fieldLabelStyle()}>End time</div>
            <PickerButton
              icon={Clock3}
              value={formatTime(item.endTime)}
              testId={`calendar-batch-end-time-${index}`}
              disabled={disabled}
              anchorRef={endTimeRef}
              onClick={() => !disabled && setOpenPicker("endTime")}
            />
          </div>
        </div>
      ) : null}

      {openPicker === "startDate" ? (
        <AnchoredFloatingPanel anchorRef={startDateRef} ariaLabel="Start date picker" {...sharedDatePickerProps}>
          <CalendarDateTimeView
            nowTick={nowTick}
            initialEpoch={new Date(`${item.startDate || item.endDate || "2026-01-01"}T12:00:00Z`).getTime()}
            onSelect={handleStartDateSelect}
            onBack={() => setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set start date"
            mode="date-only"
            allowPastDates
            submitOnDateSelect
          />
        </AnchoredFloatingPanel>
      ) : null}

      {openPicker === "endDate" ? (
        <AnchoredFloatingPanel anchorRef={endDateRef} ariaLabel="End date picker" {...sharedDatePickerProps}>
          <CalendarDateTimeView
            nowTick={nowTick}
            initialEpoch={new Date(`${item.endDate || item.startDate || "2026-01-01"}T12:00:00Z`).getTime()}
            onSelect={handleEndDateSelect}
            onBack={() => setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set end date"
            mode="date-only"
            allowPastDates
            submitOnDateSelect
          />
        </AnchoredFloatingPanel>
      ) : null}

      {openPicker === "startTime" ? (
        <AnchoredFloatingPanel anchorRef={startTimeRef} ariaLabel="Start time picker" {...sharedTimePickerProps}>
          <TimePickerView
            initialTime={item.startTime}
            onSelect={handleStartTimeSelect}
            onBack={() => setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set start time"
          />
        </AnchoredFloatingPanel>
      ) : null}

      {openPicker === "endTime" ? (
        <AnchoredFloatingPanel anchorRef={endTimeRef} ariaLabel="End time picker" {...sharedTimePickerProps}>
          <TimePickerView
            initialTime={item.endTime}
            onSelect={handleEndTimeSelect}
            onBack={() => setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set end time"
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
    <div data-testid="calendar-batch-review" style={sectionCardStyle()}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
          Batch Review
        </div>
        <div style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.5 }}>
          These will be created as individual one-off events, not a recurring series.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
