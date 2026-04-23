import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import { PickerFieldButton } from "./CalendarEditorControls";
import {
  ACCENT,
  WEEKDAY_OPTIONS,
  formatDateLabel,
  formatMonthDay,
  formatRecurrenceSummary,
  toPacificYmd,
} from "./calendarEditorUtils";

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const ENDS_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "onDate", label: "On date" },
  { value: "afterCount", label: "After count" },
];

const SELECT_PANEL_WIDTH = 180;
const DATE_PICKER_WIDTH = 300;
const DATE_PICKER_HEIGHT = 386;

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

function StyledSelect({ options, value, onChange, disabled, testId }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const selectedLabel = options.find((o) => o.value === value)?.label || value;
  const panelHeight = options.length * 34 + 8;

  const handleSelect = useCallback((optionValue) => {
    onChange(optionValue);
    setOpen(false);
  }, [onChange]);

  return (
    <div>
      <select
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        style={{
          position: "absolute",
          opacity: 0,
          width: 0,
          height: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
        tabIndex={-1}
        aria-hidden="true"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.06)",
          background: open ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.03)",
          color: "#cdd6f4",
          fontSize: 12,
          fontFamily: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          boxSizing: "border-box",
          textAlign: "left",
          transition: "background 140ms, border-color 140ms",
        }}
      >
        <span>{selectedLabel}</span>
        <ChevronDown
          size={12}
          style={{
            color: "rgba(205,214,244,0.45)",
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 140ms",
          }}
        />
      </button>
      {open ? (
        <AnchoredFloatingPanel
          anchorRef={anchorRef}
          panelRef={panelRef}
          onClose={() => setOpen(false)}
          width={SELECT_PANEL_WIDTH}
          height={panelHeight}
          matchAnchorWidth
          minWidth={140}
          maxWidth={280}
          role="listbox"
          ariaLabel="Select option"
          style={{ padding: 4, zIndex: 10001 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {options.map((o) => {
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(o.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "none",
                    background: isSelected ? "rgba(203,166,218,0.12)" : "transparent",
                    color: isSelected ? "#cba6da" : "#cdd6f4",
                    fontSize: 12,
                    fontWeight: isSelected ? 600 : 400,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 100ms",
                  }}
                  onMouseEnter={(event) => {
                    if (!isSelected) event.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = isSelected ? "rgba(203,166,218,0.12)" : "transparent";
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </AnchoredFloatingPanel>
      ) : null}
    </div>
  );
}

function InlineInput({ type, value, testId, disabled, onChange, min, step }) {
  return (
    <input
      data-testid={testId}
      type={type}
      value={value}
      min={min}
      step={step}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => event.stopPropagation()}
      style={{
        width: "100%",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        padding: "8px 10px",
        color: "#cdd6f4",
        fontSize: 12,
        outline: "none",
        boxSizing: "border-box",
        fontFamily: "inherit",
      }}
    />
  );
}

function RecurrenceUntilDatePicker({ value, startDate, disabled, onChange, testId }) {
  const [open, setOpen] = useState(false);
  const [nowTick] = useState(() => Date.now());
  const anchorRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open || disabled) return undefined;

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open, disabled]);

  const showPicker = open && !disabled;

  return (
    <>
      <PickerFieldButton
        anchorRef={anchorRef}
        icon={CalendarDays}
        value={value ? formatDateLabel(value) : ""}
        placeholder="Choose date"
        dataTestId={testId}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        trailingLabel=""
      />
      {showPicker ? (
        <AnchoredFloatingPanel
          anchorRef={anchorRef}
          panelRef={panelRef}
          onClose={() => setOpen(false)}
          width={DATE_PICKER_WIDTH}
          height={DATE_PICKER_HEIGHT}
          role="dialog"
          ariaLabel="Recurrence end date picker"
          style={{ overflow: "hidden", padding: 8, zIndex: 10001 }}
        >
          <CalendarDateTimeView
            nowTick={nowTick}
            initialEpoch={new Date(`${value || startDate || "2026-01-01"}T12:00:00Z`).getTime()}
            onSelect={(epoch) => {
              onChange(toPacificYmd(epoch));
              setOpen(false);
            }}
            onBack={() => setOpen(false)}
            accent={ACCENT}
            confirmLabel="Set recurrence end date"
            mode="date-only"
            allowPastDates
            submitOnDateSelect
          />
        </AnchoredFloatingPanel>
      ) : null}
    </>
  );
}

export default function CalendarRecurrenceSection({
  recurrenceDraft,
  startDate,
  disabled,
  onUpdateRecurrence,
  onToggleWeekday,
}) {
  if (!recurrenceDraft) return null;

  return (
    <div data-testid="calendar-recurrence-section" style={sectionCardStyle()}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
          Recurrence
        </div>
        <div style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.5 }}>
          {formatRecurrenceSummary(recurrenceDraft, startDate) || "This event will repeat as a series."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={fieldLabelStyle()}>Frequency</div>
          <StyledSelect
            options={FREQUENCY_OPTIONS}
            value={recurrenceDraft.frequency}
            onChange={(value) => onUpdateRecurrence("frequency", value)}
            disabled={disabled}
            testId="calendar-recurrence-frequency"
          />
        </div>
        <div>
          <div style={fieldLabelStyle()}>Every</div>
          <InlineInput
            type="number"
            min="1"
            step="1"
            value={recurrenceDraft.interval}
            testId="calendar-recurrence-interval"
            disabled={disabled}
            onChange={(value) => onUpdateRecurrence("interval", value)}
          />
        </div>
      </div>

      {recurrenceDraft.frequency === "weekly" ? (
        <div>
          <div style={fieldLabelStyle()}>Weekdays</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WEEKDAY_OPTIONS.map((option) => {
              const selected = recurrenceDraft.weekdays?.includes(option.code);
              return (
                <button
                  key={option.code}
                  type="button"
                  data-testid={`calendar-recurrence-weekday-${option.code}`}
                  disabled={disabled}
                  onClick={() => onToggleWeekday(option.code)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: selected
                      ? "1px solid rgba(203,166,218,0.34)"
                      : "1px solid rgba(255,255,255,0.08)",
                    background: selected ? "rgba(203,166,218,0.14)" : "rgba(255,255,255,0.03)",
                    color: selected ? "#cba6da" : "rgba(205,214,244,0.7)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    transition: "background 100ms, border-color 100ms",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {recurrenceDraft.frequency === "monthly" ? (
        <div
          data-testid="calendar-recurrence-derived-monthly"
          style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.5 }}
        >
          Repeats monthly on {formatMonthDay(startDate)}.
        </div>
      ) : null}

      {recurrenceDraft.frequency === "yearly" ? (
        <div
          data-testid="calendar-recurrence-derived-yearly"
          style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.5 }}
        >
          Repeats yearly on {formatMonthDay(startDate)}.
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: recurrenceDraft.ends?.type === "never" ? "1fr" : "1fr 1fr", gap: 10 }}>
        <div>
          <div style={fieldLabelStyle()}>Ends</div>
          <StyledSelect
            options={ENDS_OPTIONS}
            value={recurrenceDraft.ends?.type || "never"}
            onChange={(value) => onUpdateRecurrence("endsType", value)}
            disabled={disabled}
            testId="calendar-recurrence-ends-type"
          />
        </div>

        {recurrenceDraft.ends?.type === "onDate" ? (
          <div>
            <div style={fieldLabelStyle()}>Until</div>
            <RecurrenceUntilDatePicker
              value={recurrenceDraft.ends?.untilDate || ""}
              startDate={startDate}
              testId="calendar-recurrence-until-date"
              disabled={disabled}
              onChange={(value) => onUpdateRecurrence("untilDate", value)}
            />
          </div>
        ) : null}

        {recurrenceDraft.ends?.type === "afterCount" ? (
          <div>
            <div style={fieldLabelStyle()}>Occurrences</div>
            <InlineInput
              type="number"
              min="1"
              step="1"
              value={recurrenceDraft.ends?.count || 1}
              testId="calendar-recurrence-count"
              disabled={disabled}
              onChange={(value) => onUpdateRecurrence("count", value)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
