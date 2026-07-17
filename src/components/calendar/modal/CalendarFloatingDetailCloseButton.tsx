import { X } from "lucide-react";

export interface CalendarFloatingDetailCloseButtonProps {
  editorMode?: boolean;
  onClose?: () => void;
}

export default function CalendarFloatingDetailCloseButton({ editorMode, onClose }: CalendarFloatingDetailCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label={editorMode ? "Cancel editor" : "Close floating detail"}
      data-calendar-focus-ring="true"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClose?.();
      }}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.03)",
        color: "rgba(205,214,244,0.72)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 140ms, border-color 140ms, transform 140ms, color 140ms",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "rgba(255,255,255,0.07)";
        event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
        event.currentTarget.style.color = "#eef2ff";
        event.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "rgba(255,255,255,0.03)";
        event.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
        event.currentTarget.style.color = "rgba(205,214,244,0.72)";
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <X size={14} />
    </button>
  );
}
