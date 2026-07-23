import { useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import { DASHBOARD_TZ, epochFromLa, laComponents } from "@/components/inbox/helpers";

const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 386;
const ACCENT = "var(--sp-accent)";

function epochFromYmd(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return epochFromLa(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0);
}

function ymdFromEpoch(epochMs: number): string {
  const { year, month, day } = laComponents(epochMs);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function displayDate(value: string): string {
  const epoch = epochFromYmd(value);
  if (epoch == null) return "Choose date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: DASHBOARD_TZ,
  }).format(epoch);
}

export default function TransactionImportDateField({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [nowTick] = useState(() => Date.now());
  const initialEpoch = useMemo(() => epochFromYmd(value), [value]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-white/[0.08] bg-input-bg px-2.5 text-left text-[12px] font-medium text-foreground outline-none transition-[border-color,background-color,box-shadow,transform] duration-[var(--sp-motion-fast)] hover:border-white/[0.14] hover:bg-white/[0.03] focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/20 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-white/[0.08] disabled:hover:bg-input-bg disabled:active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays size={13} className="shrink-0 text-primary/75" aria-hidden="true" />
          <span className="truncate">{displayDate(value)}</span>
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-muted-foreground/55 transition-transform duration-[var(--sp-motion-fast)] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <AnchoredFloatingPanel
          anchorRef={triggerRef}
          panelRef={panelRef}
          onClose={() => setOpen(false)}
          width={PICKER_WIDTH}
          height={PICKER_HEIGHT}
          role="dialog"
          ariaLabel={`${ariaLabel} picker`}
          style={{ overflow: "hidden", padding: 8, zIndex: 10001 }}
        >
          <div className="flex items-center gap-2 px-2 pb-2.5 pt-1 text-[10px] font-bold uppercase tracking-[1.5px] text-muted-foreground">
            <span className="grid size-[22px] place-items-center rounded-lg border border-primary/25 bg-primary/[0.12] text-primary" aria-hidden="true">
              <CalendarDays size={12} />
            </span>
            {ariaLabel}
          </div>
          <CalendarDateTimeView
            nowTick={nowTick}
            initialEpoch={initialEpoch}
            onSelect={(epochMs) => {
              onChange(ymdFromEpoch(epochMs));
              setOpen(false);
            }}
            onBack={() => setOpen(false)}
            accent={ACCENT}
            confirmLabel="Choose date"
            mode="date-only"
            allowPastDates
          />
        </AnchoredFloatingPanel>
      ) : null}
    </>
  );
}
