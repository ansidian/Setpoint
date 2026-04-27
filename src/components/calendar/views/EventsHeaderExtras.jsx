import { Plus } from "lucide-react";
import { useState } from "react";

export default function EventsHeaderExtras({ editor, selectedDateLabel }) {
  const [hover, setHover] = useState(false);

  if (!editor?.editable) return null;
  const label = selectedDateLabel ? `New event on ${selectedDateLabel}` : "New event";
  return (
    <button
      type="button"
      onClick={editor.openCreate}
      aria-label={label}
      data-calendar-focus-ring="true"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        height: 36,
        borderRadius: 8,
        border: hover ? "1px solid rgba(203,166,218,0.34)" : "1px solid rgba(203,166,218,0.22)",
        background: hover ? "rgba(203,166,218,0.18)" : "rgba(203,166,218,0.12)",
        color: "#cba6da",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        transform: hover ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 140ms, background 140ms, border-color 140ms",
      }}
    >
      <Plus size={12} />
      New event
    </button>
  );
}
