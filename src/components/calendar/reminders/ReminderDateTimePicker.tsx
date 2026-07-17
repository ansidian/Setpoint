import { useRef, useState } from "react";
import type { RefObject } from "react";
import { Bell, CalendarClock } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import { epochFromLa, laComponents } from "@/components/inbox/helpers";
import type { ReminderDateTimeSelection } from "../../../../shared/types/reminders";

const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 386;

interface ReminderDateTimePickerProps {
  accent?: string;
  ariaLabel?: string;
  customReminder?: ReminderDateTimeSelection | null;
  disabled?: boolean;
  onSelect?: (selection: ReminderDateTimeSelection) => void;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function selectionFromEpoch(epoch: number): ReminderDateTimeSelection {
  const parts = laComponents(epoch);
  return {
    date: `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

function epochFromSelection(selection?: ReminderDateTimeSelection | null): number | null {
  const [year, month, day] = String(selection?.date || "").split("-").map(Number);
  const [hour, minute] = String(selection?.time || "").split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return epochFromLa(year!, month! - 1, day!, hour!, minute!);
}

function formatSelection(selection?: ReminderDateTimeSelection | null): string | null {
  const epoch = epochFromSelection(selection);
  if (epoch === null || !Number.isFinite(epoch)) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epoch));
}

export default function ReminderDateTimePicker({
  accent = "var(--ea-accent)",
  ariaLabel = "Custom reminder picker",
  customReminder,
  disabled = false,
  onSelect,
}: ReminderDateTimePickerProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const selectedEpoch = epochFromSelection(customReminder);
  const futureSelectedEpoch = selectedEpoch !== null && Number.isFinite(selectedEpoch) && selectedEpoch > nowTick
    ? selectedEpoch
    : null;
  const label = formatSelection(customReminder) || "Custom";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-testid="reminder-custom-picker-trigger"
        data-calendar-focus-ring="true"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setNowTick(Date.now());
          setOpen((value) => !value);
        }}
        style={{
          minHeight: 30,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "7px 9px",
          borderRadius: 8,
          border: open ? `1px solid color-mix(in srgb, ${accent} 40%, rgba(255,255,255,0.08))` : "1px solid rgba(255,255,255,0.08)",
          background: open ? `color-mix(in srgb, ${accent} 12%, rgba(255,255,255,0.025))` : "rgba(255,255,255,0.03)",
          color: disabled ? "var(--color-text-faint)" : "rgba(205,214,244,0.78)",
          fontSize: 10.5,
          fontWeight: 650,
          fontFamily: "inherit",
          lineHeight: 1,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.72 : 1,
          transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms",
        }}
        onMouseEnter={(event) => {
          if (disabled) return;
          event.currentTarget.style.transform = "translateY(-1px)";
          event.currentTarget.style.background = open ? `color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.025))` : "rgba(255,255,255,0.055)";
          event.currentTarget.style.borderColor = open ? `color-mix(in srgb, ${accent} 48%, rgba(255,255,255,0.10))` : "rgba(255,255,255,0.14)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.transform = "translateY(0)";
          event.currentTarget.style.background = open ? `color-mix(in srgb, ${accent} 12%, rgba(255,255,255,0.025))` : "rgba(255,255,255,0.03)";
          event.currentTarget.style.borderColor = open ? `color-mix(in srgb, ${accent} 40%, rgba(255,255,255,0.08))` : "rgba(255,255,255,0.08)";
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Bell size={11} color="var(--sp-cream)" aria-hidden />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
          </span>
        </span>
        <CalendarClock size={12} aria-hidden />
      </button>
      {open ? (
        <AnchoredFloatingPanel
          anchorRef={anchorRef as RefObject<HTMLElement | null>}
          panelRef={panelRef}
          onClose={() => setOpen(false)}
          width={PICKER_WIDTH}
          height={PICKER_HEIGHT}
          role="dialog"
          ariaLabel={ariaLabel}
          style={{
            overflow: "hidden",
            padding: 8,
            zIndex: 10002,
          }}
        >
          <CalendarDateTimeView
            nowTick={nowTick}
            initialEpoch={futureSelectedEpoch}
            onSelect={(epoch) => {
              onSelect?.(selectionFromEpoch(epoch));
              setOpen(false);
            }}
            onBack={() => setOpen(false)}
            accent={accent}
            confirmLabel="Add"
          />
        </AnchoredFloatingPanel>
      ) : null}
    </>
  );
}
