import { useState } from "react";
import { Plus } from "lucide-react";

export default function DeadlinesHeaderExtras({ onCreateTask }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onCreateTask?.()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderRadius: 8,
        border: hovered ? "1px solid rgba(203,166,218,0.42)" : "1px solid rgba(203,166,218,0.28)",
        background: hovered ? "rgba(203,166,218,0.16)" : "rgba(203,166,218,0.1)",
        color: "#cba6da",
        fontFamily: "inherit",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hovered ? "0 10px 22px rgba(203,166,218,0.12)" : "none",
        transition: "background 140ms, border-color 140ms, transform 140ms, box-shadow 140ms",
      }}
    >
      <Plus size={12} />
      <span>New Todoist</span>
    </button>
  );
}
