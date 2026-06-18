import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import TimePickerView from "@/components/shared/pickers/TimePickerView";
import { formatDateLabel, formatTimeLabel } from "./calendarEditorUtils";
import {
  applyCompactScheduleDate,
  applyCompactScheduleTime,
  getCompactScheduleMonthCells,
  isDateInDraftRange,
  monthFromDateKey,
} from "./calendarCompactSchedulePickerModel";

const ACCENT = "var(--ea-accent)";

const segmentStyle = (active) => ({
  border: active ? "1px solid rgba(203,166,218,0.36)" : "1px solid rgba(255,255,255,0.07)",
  background: active ? "rgba(203,166,218,0.14)" : "rgba(255,255,255,0.035)",
  color: active ? "#f5e0ff" : "rgba(205,214,244,0.74)",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
  transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms",
});

function formatRangeSummary(draft) {
  const dateLabel = draft.startDate === draft.endDate
    ? formatDateLabel(draft.startDate)
    : `${formatDateLabel(draft.startDate)} to ${formatDateLabel(draft.endDate)}`;
  if (draft.allDay) return `${dateLabel} · All day`;
  return `${dateLabel} · ${formatTimeLabel(draft.startTime)} to ${formatTimeLabel(draft.endTime)}`;
}

function TimeSelectButton({ label, value, active, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label}: ${formatTimeLabel(value)}`}
      onClick={onClick}
      style={{
        ...segmentStyle(active),
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 3,
        minWidth: 0,
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 750, color: active ? "#f5e0ff" : "var(--color-text-faint)" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, fontWeight: 750, color: active ? "#ffffff" : "rgba(205,214,244,0.86)" }}>
        {formatTimeLabel(value)}
      </span>
    </button>
  );
}

export default function CalendarEventCompactSchedulePicker({
  draft,
  updateField,
  initialField = "startDate",
  onClose,
  showAllDayToggle = true,
}) {
  const initialMonth = monthFromDateKey(
    initialField === "endDate" ? draft.endDate : draft.startDate,
    draft.startDate || draft.endDate,
  );
  const [activeDateField, setActiveDateField] = useState(initialField === "endDate" ? "endDate" : "startDate");
  const [activeTimeField, setActiveTimeField] = useState(initialField === "endTime" ? "endTime" : initialField === "startTime" ? "startTime" : null);
  const [viewMonth, setViewMonth] = useState(initialMonth.month);
  const [viewYear, setViewYear] = useState(initialMonth.year);
  const cells = useMemo(() => getCompactScheduleMonthCells(viewYear, viewMonth), [viewMonth, viewYear]);
  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 15, 12)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const applyDraftPatch = (nextDraft) => {
    ["startDate", "endDate", "startTime", "endTime", "allDay"].forEach((field) => {
      if (nextDraft[field] !== draft[field]) updateField(field, nextDraft[field]);
    });
  };

  const changeMonth = (delta) => {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1, 12));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  };

  const selectDate = (dateKey) => {
    const nextDraft = applyCompactScheduleDate(draft, activeDateField, dateKey);
    applyDraftPatch(nextDraft);
    if (activeDateField === "startDate") setActiveDateField("endDate");
  };

  const updateTime = (field, value) => {
    applyDraftPatch(applyCompactScheduleTime(draft, field, value));
  };

  const selectTime = (value) => {
    if (!activeTimeField) return;
    updateTime(activeTimeField, value);
    setActiveTimeField(null);
  };

  return (
    <div
      data-suspend-calendar-hotkeys="true"
      data-testid="calendar-compact-schedule-picker"
      style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}
    >
      <div
        data-testid="calendar-compact-schedule-summary"
        style={{
          border: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.035)",
          borderRadius: 10,
          padding: "9px 10px",
          color: "rgba(205,214,244,0.86)",
          fontSize: 12,
          fontWeight: 650,
          lineHeight: 1.35,
        }}
      >
        {formatRangeSummary(draft)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button
          type="button"
          aria-pressed={activeDateField === "startDate"}
          onClick={() => {
            setActiveDateField("startDate");
            setActiveTimeField(null);
          }}
          style={segmentStyle(activeDateField === "startDate")}
        >
          Start date
        </button>
        <button
          type="button"
          aria-pressed={activeDateField === "endDate"}
          onClick={() => {
            setActiveDateField("endDate");
            setActiveTimeField(null);
          }}
          style={segmentStyle(activeDateField === "endDate")}
        >
          End date
        </button>
      </div>

      <div role="group" aria-label="Compact schedule month">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px 6px" }}>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => changeMonth(-1)}
            style={segmentStyle(false)}
          >
            <ChevronLeft size={13} />
          </button>
          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{monthLabel}</div>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => changeMonth(1)}
            style={segmentStyle(false)}
          >
            <ChevronRight size={13} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, padding: "0 2px 3px" }}>
          {["S", "M", "T", "W", "T", "F", "S"].map((dayLetter, index) => (
            <div
              key={`${dayLetter}-${index}`}
              style={{ textAlign: "center", fontSize: 9.5, fontWeight: 700, color: "var(--color-text-faint)" }}
            >
              {dayLetter}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {cells.map((cell) => {
            const isStart = cell.dateKey === draft.startDate;
            const isEnd = cell.dateKey === draft.endDate;
            const inRange = isDateInDraftRange(cell.dateKey, draft);
            const disabled = activeDateField === "endDate" && !!draft.startDate && cell.dateKey < draft.startDate;
            const selected = isStart || isEnd;
            const background = selected
              ? ACCENT
              : inRange
                ? "rgba(203,166,218,0.16)"
                : "transparent";

            return (
              <button
                key={cell.dateKey}
                type="button"
                disabled={disabled}
                aria-current={selected ? "date" : undefined}
                data-range-role={isStart && isEnd ? "start end" : isStart ? "start" : isEnd ? "end" : inRange ? "inside" : undefined}
                onClick={() => selectDate(cell.dateKey)}
                style={{
                  height: 28,
                  border: inRange ? "1px solid rgba(203,166,218,0.22)" : "1px solid transparent",
                  borderRadius: 7,
                  background,
                  color: disabled
                    ? "var(--color-text-faint)"
                    : selected
                      ? "#ffffff"
                      : cell.inMonth
                        ? "rgba(205,214,244,0.82)"
                        : "var(--color-text-faint)",
                  fontSize: 12,
                  fontWeight: selected ? 750 : 600,
                  fontFamily: "inherit",
                  cursor: disabled ? "not-allowed" : "pointer",
                  transition: "background 120ms, border-color 120ms, color 120ms, transform 120ms",
                }}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>

      {showAllDayToggle ? (
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 650,
            color: "rgba(205,214,244,0.74)",
          }}
        >
          <input
            type="checkbox"
            aria-label="All day"
            checked={draft.allDay}
            onChange={(event) => {
              setActiveTimeField(null);
              updateField("allDay", event.target.checked);
            }}
            style={{ accentColor: "#cba6da" }}
          />
          All day
        </label>
      ) : null}

      {!draft.allDay ? (
        <>
          <div role="group" aria-label="Compact schedule time" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <TimeSelectButton
              label="Start time"
              value={draft.startTime}
              active={activeTimeField === "startTime"}
              onClick={() => setActiveTimeField((current) => current === "startTime" ? null : "startTime")}
            />
            <TimeSelectButton
              label="End time"
              value={draft.endTime}
              active={activeTimeField === "endTime"}
              onClick={() => setActiveTimeField((current) => current === "endTime" ? null : "endTime")}
            />
          </div>
          {activeTimeField ? (
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 10,
                background: "rgba(255,255,255,0.025)",
                overflow: "hidden",
              }}
            >
              <TimePickerView
                initialTime={draft[activeTimeField]}
                onSelect={selectTime}
                onBack={() => setActiveTimeField(null)}
                accent={ACCENT}
                confirmLabel={`Set ${activeTimeField === "startTime" ? "start" : "end"} time`}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 2 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: `1px solid ${ACCENT}`,
            background: ACCENT,
            color: "#ffffff",
            borderRadius: 8,
            padding: "7px 13px",
            fontSize: 11,
            fontWeight: 750,
            fontFamily: "inherit",
            cursor: "pointer",
            transition: "transform 140ms, background 140ms",
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
