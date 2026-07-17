import { useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, WheelEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NumberField } from "@/components/inbox/primitives";
import {
  DASHBOARD_TZ,
  epochFromLa,
  laComponents,
} from "@/components/inbox/helpers";

type CalendarDay = {
  year: number;
  month: number;
  day: number;
};

export type CalendarDateTimeViewProps = {
  nowTick: number;
  onSelect: (epoch: number) => void;
  onBack: () => void;
  initialEpoch?: number | null;
  accent?: string;
  confirmLabel?: string;
  mode?: "date-time" | "date-only";
  allowPastDates?: boolean;
  submitOnDateSelect?: boolean;
};

export default function CalendarDateTimeView({
  nowTick,
  onSelect,
  onBack,
  initialEpoch = null,
  accent = "#f97316",
  confirmLabel = "Confirm",
  mode = "date-time",
  allowPastDates = false,
  submitOnDateSelect = false,
}: CalendarDateTimeViewProps) {
  const monthWheelDeltaRef = useRef(0);
  const today = useMemo(() => laComponents(nowTick), [nowTick]);
  const showTime = mode !== "date-only";
  const [draft, setDraft] = useState(() => {
    if (typeof initialEpoch === "number" && Number.isFinite(initialEpoch)) return laComponents(initialEpoch);
    if (!showTime) return { ...today, hour: 12, minute: 0 };
    const nextMinute = Math.ceil(nowTick / 60_000) * 60_000;
    return laComponents(nextMinute);
  });
  const [viewYear, setViewYear] = useState(draft.year);
  const [viewMonth, setViewMonth] = useState(draft.month);
  const [ampmFocused, setAmPmFocused] = useState(false);

  const cells = useMemo(() => {
    const firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
    const out: Array<CalendarDay & { inMonth: boolean }> = [];
    for (let i = 0; i < 42; i += 1) {
      const dayOffset = i - firstDow;
      const cellDate = new Date(Date.UTC(viewYear, viewMonth, 1 + dayOffset));
      out.push({
        year: cellDate.getUTCFullYear(),
        month: cellDate.getUTCMonth(),
        day: cellDate.getUTCDate(),
        inMonth: cellDate.getUTCMonth() === viewMonth,
      });
    }
    return out;
  }, [viewYear, viewMonth]);

  const compareDay = (a: CalendarDay, b: CalendarDay) =>
    (a.year - b.year) || (a.month - b.month) || (a.day - b.day);

  const changeMonth = (delta: number) => {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  };

  const handleCalendarWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    event.preventDefault();
    monthWheelDeltaRef.current += event.deltaY;
    if (Math.abs(monthWheelDeltaRef.current) < 60) return;
    changeMonth(monthWheelDeltaRef.current > 0 ? 1 : -1);
    monthWheelDeltaRef.current = 0;
  };

  const selectDay = (cell: CalendarDay) => {
    if (!allowPastDates && compareDay(cell, today) < 0) return;
    const isSameDay =
      cell.year === draft.year && cell.month === draft.month && cell.day === draft.day;
    if (!showTime && (submitOnDateSelect || isSameDay)) {
      onSelect(epochFromLa(cell.year, cell.month, cell.day, 12, 0));
      return;
    }
    setDraft((prev) => ({ ...prev, year: cell.year, month: cell.month, day: cell.day }));
    if (cell.month !== viewMonth || cell.year !== viewYear) {
      setViewYear(cell.year);
      setViewMonth(cell.month);
    }
  };

  const hour24 = draft.hour;
  const hour12 = ((hour24 + 11) % 12) + 1;
  const minute = draft.minute;
  const isPm = hour24 >= 12;

  const setHour12 = (hour: number) => {
    const nextHour24 = isPm ? (hour % 12) + 12 : hour % 12;
    setDraft((prev) => ({ ...prev, hour: nextHour24 }));
  };

  const setMinuteVal = (value: number) => {
    setDraft((prev) => ({ ...prev, minute: Math.max(0, Math.min(59, value)) }));
  };

  const setAmPm = (pm: boolean) => {
    const nextHour24 = (hour24 % 12) + (pm ? 12 : 0);
    setDraft((prev) => ({ ...prev, hour: nextHour24 }));
  };

  const handleAmPmHotkey = (key: string, event: KeyboardEvent<HTMLElement>) => {
    const normalized = key.toLowerCase();
    if (normalized !== "a" && normalized !== "p") return false;
    event.preventDefault();
    event.stopPropagation();
    setAmPm(normalized === "p");
    return true;
  };

  const handleAmPmKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    if (handleAmPmHotkey(key, event)) return;
    if (key === "arrowleft" || key === "arrowdown") {
      event.preventDefault();
      event.stopPropagation();
      setAmPm(false);
      return;
    }
    if (key === "arrowright" || key === "arrowup") {
      event.preventDefault();
      event.stopPropagation();
      setAmPm(true);
      return;
    }
    if (key === " " || key === "enter") {
      event.preventDefault();
      event.stopPropagation();
      setAmPm(!isPm);
    }
  };

  const draftEpoch = showTime
    ? epochFromLa(draft.year, draft.month, draft.day, draft.hour, draft.minute)
    : epochFromLa(draft.year, draft.month, draft.day, 12, 0);
  const confirmDisabled = showTime
    ? (!allowPastDates && draftEpoch <= nowTick)
    : (!allowPastDates && compareDay(draft, today) < 0);
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: DASHBOARD_TZ,
  }).format(new Date(Date.UTC(viewYear, viewMonth, 15, 12)));

  const navBtn = (active = false): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    padding: 0,
    background: active ? "rgba(255,255,255,0.04)" : "transparent",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    color: "rgba(205,214,244,0.75)",
    transition: "background 120ms, color 120ms",
  });

  const segmentBtn = (selected: boolean): CSSProperties => ({
    padding: "4px 10px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    fontFamily: "inherit",
    border: "none",
    cursor: "pointer",
    borderRadius: 6,
    background: selected ? accent : "transparent",
    color: selected ? "#ffffff" : "rgba(205,214,244,0.65)",
    transition: "background 120ms, color 120ms",
  });

  const submitCurrentDraft = (event?: KeyboardEvent<HTMLElement> | MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (confirmDisabled) return;
    onSelect(draftEpoch);
  };

  return (
    <div
      data-suspend-calendar-hotkeys="true"
      style={{ display: "flex", flexDirection: "column" }}
      onKeyDownCapture={(event) => {
        if (!showTime) return;
        if (event.key === "Enter") {
          submitCurrentDraft(event);
          return;
        }
        handleAmPmHotkey(event.key, event);
      }}
    >
      <div
        role="group"
        aria-label="Calendar month view"
        onWheel={handleCalendarWheel}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 6px 8px",
          }}
        >
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => changeMonth(-1)}
            style={navBtn()}
            onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
          >
            <ChevronLeft size={14} />
          </button>
          <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>
            {monthLabel}
          </div>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => changeMonth(1)}
            style={navBtn()}
            onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 2,
            padding: "0 4px 4px",
          }}
        >
          {["S", "M", "T", "W", "T", "F", "S"].map((dayLetter, index) => (
            <div
              key={index}
              style={{
                textAlign: "center",
                fontSize: 10,
                fontWeight: 600,
                color: "var(--color-text-faint)",
                letterSpacing: 0.4,
                padding: "4px 0",
              }}
            >
              {dayLetter}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 2,
            padding: "0 4px 8px",
          }}
        >
          {cells.map((cell, index) => {
            const isPast = !allowPastDates && compareDay(cell, today) < 0;
            const isToday = compareDay(cell, today) === 0;
            const isSelected =
              cell.year === draft.year && cell.month === draft.month && cell.day === draft.day;
            const baseColor = !cell.inMonth
              ? "var(--color-text-faint)"
              : isPast
                ? "rgba(205,214,244,0.22)"
                : "rgba(205,214,244,0.85)";

            return (
              <button
                key={index}
                type="button"
                disabled={isPast}
                onClick={() => selectDay(cell)}
                onMouseEnter={(event) => {
                  if (isPast || isSelected) return;
                  event.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(event) => {
                  if (isSelected) return;
                  event.currentTarget.style.background = "transparent";
                }}
                style={{
                  height: 28,
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontFamily: "inherit",
                  fontWeight: isSelected ? 700 : 500,
                  fontVariantNumeric: "tabular-nums",
                  color: isSelected ? "#ffffff" : baseColor,
                  background: isSelected ? accent : "transparent",
                  border: isToday && !isSelected
                    ? `1px solid color-mix(in srgb, ${accent} 60%, transparent)`
                    : "1px solid transparent",
                  borderRadius: 6,
                  cursor: isPast ? "not-allowed" : "pointer",
                  transition: "background 120ms, color 120ms",
                }}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>

      {showTime ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "8px 12px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <NumberField
            value={hour12}
            onChange={setHour12}
            min={1}
            max={12}
            ariaLabel="hour"
            accent={accent}
          />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-faint)" }}>:</div>
          <NumberField
            value={minute}
            onChange={setMinuteVal}
            min={0}
            max={59}
            pad={2}
            ariaLabel="minute"
            accent={accent}
          />
          <div
            style={{
              display: "inline-flex",
              marginLeft: 4,
              padding: 2,
              gap: 2,
              background: "rgba(255,255,255,0.04)",
              border: ampmFocused
                ? `1px solid color-mix(in srgb, ${accent} 55%, transparent)`
                : "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8,
              boxShadow: ampmFocused
                ? `0 0 0 1px color-mix(in srgb, ${accent} 14%, transparent)`
                : "none",
              transition: "border-color 120ms, box-shadow 120ms",
            }}
            role="group"
            aria-label="AM or PM"
            tabIndex={0}
            onFocus={() => setAmPmFocused(true)}
            onBlur={() => setAmPmFocused(false)}
            onKeyDown={handleAmPmKeyDown}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-pressed={!isPm}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setAmPm(false)}
              style={segmentBtn(!isPm)}
            >
              AM
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-pressed={isPm}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setAmPm(true)}
              style={segmentBtn(isPm)}
            >
              PM
            </button>
          </div>
        </div>
      ) : null}

      {submitOnDateSelect && !showTime ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            padding: "8px 10px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <button
            type="button"
            onClick={onBack}
            onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 10px",
              borderRadius: 8,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(205,214,244,0.75)",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "background 120ms",
            }}
          >
            <ChevronLeft size={12} />
            Back
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <button
            type="button"
            onClick={onBack}
            onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 10px",
              borderRadius: 8,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(205,214,244,0.75)",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "background 120ms",
            }}
          >
            <ChevronLeft size={12} />
            Back
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={submitCurrentDraft}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: confirmDisabled
                ? `color-mix(in srgb, ${accent} 20%, transparent)`
                : accent,
              border: confirmDisabled
                ? `1px solid color-mix(in srgb, ${accent} 25%, transparent)`
                : `1px solid ${accent}`,
              color: confirmDisabled ? "rgba(255,255,255,0.5)" : "#ffffff",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.3,
              fontFamily: "inherit",
              cursor: confirmDisabled ? "not-allowed" : "pointer",
              transition: "background 120ms, transform 120ms",
            }}
            onMouseEnter={(event) => {
              if (confirmDisabled) return;
              event.currentTarget.style.background = `color-mix(in srgb, ${accent} 82%, white)`;
            }}
            onMouseLeave={(event) => {
              if (confirmDisabled) return;
              event.currentTarget.style.background = accent;
            }}
          >
            {confirmLabel}
          </button>
        </div>
      )}
    </div>
  );
}
