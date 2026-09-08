import { X } from "lucide-react";
import "../detail-cards.css";

export interface CalendarFloatingDetailCloseButtonProps {
  editorMode?: boolean;
  onClose?: () => void;
}

export default function CalendarFloatingDetailCloseButton({ editorMode, onClose }: CalendarFloatingDetailCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label={editorMode ? "Cancel editor" : "Close floating detail"}
      className="detail-panel-close"
      data-calendar-focus-ring="true"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClose?.();
      }}
    >
      <X size={14} aria-hidden="true" />
    </button>
  );
}
