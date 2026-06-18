import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { NumberField } from "@/components/inbox/primitives";

function parseTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return { hour: 9, minute: 0 };
  }
  const [hour, minute] = value.split(":").map(Number);
  return {
    hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 9,
    minute: Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0,
  };
}

function toTimeValue(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function TimePickerView({
  initialTime = "09:00",
  onSelect,
  onBack,
  accent = "var(--ea-accent)",
  confirmLabel = "Set time",
}) {
  const confirmButtonRef = useRef(null);
  const hourInputRef = useRef(null);
  const advanceFocusToConfirmRef = useRef(false);
  const parsed = parseTime(initialTime);
  const [hour24, setHour24] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [ampmFocused, setAmPmFocused] = useState(false);

  const hour12 = ((hour24 + 11) % 12) + 1;
  const isPm = hour24 >= 12;

  const setHour12 = (hour) => {
    const nextHour24 = isPm ? (hour % 12) + 12 : hour % 12;
    setHour24(nextHour24);
  };

  const setMinuteVal = (value) => {
    setMinute(Math.max(0, Math.min(59, value)));
  };

  const setAmPm = (pm) => {
    const nextHour24 = (hour24 % 12) + (pm ? 12 : 0);
    setHour24(nextHour24);
  };

  const submitCurrentTime = (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    onSelect(toTimeValue(hour24, minute));
  };

  const handleAmPmHotkey = (key, event) => {
    const normalized = key.toLowerCase();
    if (normalized !== "a" && normalized !== "p") return false;
    event.preventDefault();
    event.stopPropagation();
    advanceFocusToConfirmRef.current = true;
    setAmPm(normalized === "p");
    return true;
  };

  const handleAmPmKeyDown = (event) => {
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

  useEffect(() => {
    hourInputRef.current?.focus();
    hourInputRef.current?.select?.();
  }, []);

  useEffect(() => {
    if (!advanceFocusToConfirmRef.current) return;
    advanceFocusToConfirmRef.current = false;
    confirmButtonRef.current?.focus();
  }, [hour24]);

  return (
    <div
      data-suspend-calendar-hotkeys="true"
      style={{ display: "flex", flexDirection: "column" }}
      onKeyDownCapture={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          submitCurrentTime(event);
          return;
        }
        handleAmPmHotkey(event.key, event);
      }}
    >
      <div
        style={{
          padding: "8px 12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "var(--color-text-faint)" }}>
          Time
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.92)", fontWeight: 600 }}>
          {new Date(`2000-01-01T${toTimeValue(hour24, minute)}:00`).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "10px 12px 14px",
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
          autoFocus
          inputRef={hourInputRef}
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
            style={{
              padding: "4px 10px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.5,
              fontFamily: "inherit",
              border: "none",
              cursor: "pointer",
              borderRadius: 6,
              background: !isPm ? accent : "transparent",
              color: !isPm ? "#ffffff" : "rgba(205,214,244,0.65)",
              transition: "background 120ms, color 120ms",
            }}
          >
            AM
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-pressed={isPm}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setAmPm(true)}
            style={{
              padding: "4px 10px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.5,
              fontFamily: "inherit",
              border: "none",
              cursor: "pointer",
              borderRadius: 6,
              background: isPm ? accent : "transparent",
              color: isPm ? "#ffffff" : "rgba(205,214,244,0.65)",
              transition: "background 120ms, color 120ms",
            }}
          >
            PM
          </button>
        </div>
      </div>

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
          ref={confirmButtonRef}
          type="button"
          onClick={submitCurrentTime}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            background: accent,
            border: `1px solid ${accent}`,
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.3,
            fontFamily: "inherit",
            cursor: "pointer",
            transition: "background 120ms, transform 120ms",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = `color-mix(in srgb, ${accent} 82%, white)`;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = accent;
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
