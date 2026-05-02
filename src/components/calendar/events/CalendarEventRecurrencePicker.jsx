import { useState } from "react";
import { Check, Repeat } from "lucide-react";
import CalendarRecurrenceSection from "./CalendarRecurrenceSection";
import { formatRecurrenceSummary } from "./calendarEditorUtils";

const PRESETS = [
  { value: "", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

function PresetButton({ option, selected, disabled, onSelect }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={() => onSelect(option.value)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 8,
        minHeight: 34,
        padding: "7px 9px",
        borderRadius: 8,
        border: selected
          ? "1px solid rgba(203,166,218,0.34)"
          : hover && !disabled
            ? "1px solid rgba(255,255,255,0.13)"
            : "1px solid rgba(255,255,255,0.06)",
        background: selected
          ? "rgba(203,166,218,0.13)"
          : hover && !disabled
            ? "rgba(255,255,255,0.055)"
            : "rgba(255,255,255,0.03)",
        color: selected ? "#f5e0ff" : "rgba(205,214,244,0.78)",
        fontSize: 12,
        fontWeight: 650,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.66 : 1,
        transform: hover && !disabled ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms",
      }}
    >
      <span>{option.label}</span>
      <Check size={13} style={{ color: selected ? "#cba6da" : "transparent" }} />
    </button>
  );
}

export default function CalendarEventRecurrencePicker({
  recurrenceDraft,
  startDate,
  disabled,
  onSelectPreset,
  onUpdateRecurrence,
  onToggleWeekday,
}) {
  const selectedValue = recurrenceDraft?.frequency || "";
  const summary = formatRecurrenceSummary(recurrenceDraft, startDate) || "Does not repeat";

  return (
    <div
      data-suspend-calendar-hotkeys="true"
      data-testid="calendar-event-recurrence-picker"
      style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "3px 2px 2px",
          color: "rgba(205,214,244,0.72)",
          fontSize: 10,
          fontWeight: 750,
          letterSpacing: 1.7,
          textTransform: "uppercase",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 8,
            display: "inline-grid",
            placeItems: "center",
            color: "var(--ea-accent)",
            background: "color-mix(in srgb, var(--ea-accent) 14%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ea-accent) 24%, transparent)",
          }}
        >
          <Repeat size={12} />
        </span>
        Repeat
      </div>

      <div
        data-testid="calendar-event-repeat-summary"
        style={{
          padding: "8px 9px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.03)",
          color: "rgba(205,214,244,0.72)",
          fontSize: 11.5,
          lineHeight: 1.4,
        }}
      >
        {summary}
      </div>

      <div role="listbox" aria-label="Repeat presets" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {PRESETS.map((option) => (
          <PresetButton
            key={option.value || "none"}
            option={option}
            selected={selectedValue === option.value}
            disabled={disabled}
            onSelect={onSelectPreset}
          />
        ))}
      </div>

      {recurrenceDraft ? (
        <CalendarRecurrenceSection
          recurrenceDraft={recurrenceDraft}
          startDate={startDate}
          disabled={disabled}
          onUpdateRecurrence={onUpdateRecurrence}
          onToggleWeekday={onToggleWeekday}
          compact
        />
      ) : null}
    </div>
  );
}
