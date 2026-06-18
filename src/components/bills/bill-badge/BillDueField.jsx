import { useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/bill-utils";
import { epochFromLa, laComponents } from "@/components/inbox/helpers";
import BillDuePicker from "./BillDuePicker";

function ymdFromEpoch(epochMs) {
  const { year, month, day } = laComponents(epochMs);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function epochFromDateString(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return null;
  return epochFromLa(year, month - 1, day, 12, 0);
}

export default function BillDueField({
  editDue,
  setEditDue,
  isMobile = false,
}) {
  const triggerRef = useRef(null);
  const pickerRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nowTick] = useState(() => Date.now());
  const dueDisplay = editDue ? formatDate(editDue) : "";
  const initialEpoch = useMemo(() => epochFromDateString(editDue), [editDue]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setPickerOpen((open) => !open)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-label="Set bill due date"
        className={cn(
          "w-full rounded-md border border-white/[0.08] bg-input-bg text-left font-medium text-foreground transition-colors hover:border-white/[0.12] hover:bg-white/[0.03]",
          isMobile ? "h-10 px-3 text-[14px]" : "h-8 px-2.5 text-[13px]",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "flex min-w-0 items-center gap-2 truncate",
              dueDisplay ? "text-foreground" : "text-muted-foreground/75",
            )}
          >
            <CalendarDays size={isMobile ? 15 : 13} />
            <span className="truncate">{dueDisplay || "Pick due date"}</span>
          </span>
          <ChevronDown size={isMobile ? 15 : 13} className="shrink-0 text-muted-foreground/45" />
        </span>
      </button>

      {pickerOpen ? (
        <BillDuePicker
          anchorRef={triggerRef}
          panelRef={pickerRef}
          nowTick={nowTick}
          initialEpoch={initialEpoch}
          onSelect={(epochMs) => {
            setEditDue(ymdFromEpoch(epochMs));
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
