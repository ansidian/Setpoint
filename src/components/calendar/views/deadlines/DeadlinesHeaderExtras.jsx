import { useState } from "react";
import { Plus } from "lucide-react";

export default function DeadlinesHeaderExtras({ onCreateTask, selectedDate, selectedDateLabel }) {
  const [hovered, setHovered] = useState(false);
  const label = selectedDateLabel
    ? `New deadline due ${selectedDateLabel}`
    : "New deadline";

  return (
    <button
      type="button"
      onClick={() => onCreateTask?.(selectedDate || null)}
      aria-label={label}
      data-calendar-focus-ring="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderRadius: 8,
        border: hovered ? "1px solid color-mix(in srgb, var(--sp-accent) 42%, transparent)" : "1px solid color-mix(in srgb, var(--sp-accent) 28%, transparent)",
        background: hovered ? "color-mix(in srgb, var(--sp-accent) 16%, transparent)" : "color-mix(in srgb, var(--sp-accent) 10%, transparent)",
        color: "var(--sp-accent)",
        fontFamily: "inherit",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hovered ? "0 10px 22px color-mix(in srgb, var(--sp-accent) 12%, transparent)" : "none",
        transition: "background 140ms, border-color 140ms, transform 140ms, box-shadow 140ms",
      }}
    >
      <Plus size={12} />
      <span>New deadline</span>
    </button>
  );
}
