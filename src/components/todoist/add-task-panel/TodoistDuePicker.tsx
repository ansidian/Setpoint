import { CalendarClock } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import type { RefObject } from "react";

const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 432;
const ACCENT = "var(--sp-accent)";

export default function TodoistDuePicker({
  anchorRef,
  panelRef,
  nowTick,
  initialEpoch,
  onSelect,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  nowTick: number;
  initialEpoch: number | null;
  onSelect: (epochMs: number) => void;
  onClose: () => void;
}) {
  const width = PICKER_WIDTH;
  const height = PICKER_HEIGHT;
  return (
    <AnchoredFloatingPanel
      anchorRef={anchorRef}
      panelRef={panelRef}
      onClose={onClose}
      width={width}
      height={height}
      role="dialog"
      ariaLabel="Todoist due date picker"
      style={{
        overflow: "hidden",
        padding: 8,
        zIndex: 10001,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 8px 10px",
          color: "rgba(205,214,244,0.72)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 2,
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
            color: ACCENT,
            background: `color-mix(in srgb, ${ACCENT} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${ACCENT} 24%, transparent)`,
          }}
        >
          <CalendarClock size={12} />
        </span>
        Due date
      </div>
      <CalendarDateTimeView
        nowTick={nowTick}
        initialEpoch={initialEpoch}
        onSelect={onSelect}
        onBack={onClose}
        accent={ACCENT}
        confirmLabel="Set due date"
        allowPastDates
      />
    </AnchoredFloatingPanel>
  );
}
