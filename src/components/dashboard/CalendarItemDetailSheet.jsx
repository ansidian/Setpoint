import { useState } from "react";
import { CalendarDays, ExternalLink, Receipt } from "lucide-react";
import BottomSheet from "../ui/BottomSheet";
import { daysUntil, formatAmount } from "../../lib/bill-utils";
import { daysLabel, formatEventTime, formatEventDuration } from "../../lib/shell-helpers";

// Mobile-only in-place detail sheet for a dashboard bill/event tap. Mirrors the
// dashboard-local DeadlineDetailPopover pattern (a BottomSheet that reads the
// tapped record directly) instead of switching to the Calendar tab. The single
// action re-runs the same openCalendar deep-link the desktop tap uses, which
// scrolls the agenda to the item's date — wired by the shell via onOpenInCalendar.

function InfoRow({ label, value, color }) {
  if (value == null || value === "") return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
      <span style={{ color: "var(--color-text-faint)", letterSpacing: 0.3, textTransform: "uppercase", fontSize: 9.5, fontWeight: 600, width: 60 }}>
        {label}
      </span>
      <span style={{ color: color || "rgba(205,214,244,0.85)", fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}

function OpenInCalendarButton({ accent, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        minHeight: "var(--sp-touch-min)", padding: "0 14px", borderRadius: 8,
        fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        color: accent,
        background: hover ? `${accent}1c` : `${accent}10`,
        border: `1px solid ${accent}${hover ? "55" : "38"}`,
        transition: "background 140ms, border-color 140ms",
      }}
    >
      <ExternalLink size={12} />
      Open in calendar
    </button>
  );
}

export default function CalendarItemDetailSheet({ kind, item, accent = "#cba6da", onClose, onOpenInCalendar }) {
  if (!item) return null;
  const isBill = kind === "bill";
  const label = isBill ? "Bill" : "Event";
  const tint = isBill ? "var(--sp-green)" : accent;
  const Icon = isBill ? Receipt : CalendarDays;

  const title = isBill
    ? (item.name || item.payee || "Bill")
    : (item.title || item.summary || "Event");

  let whenValue = null;
  let amountValue = null;
  if (isBill) {
    whenValue = item.next_date ? daysLabel(daysUntil(item.next_date)) : null;
    amountValue = item.amount != null ? formatAmount(item.amount) : null;
  } else if (item.allDay) {
    whenValue = "All day";
  } else if (item.startMs) {
    const time = formatEventTime(item.startMs);
    const dur = formatEventDuration(item.startMs, item.endMs);
    whenValue = dur ? `${time} · ${dur}` : time;
  }

  return (
    <BottomSheet open onClose={onClose} title={label}>
      <div>
        {/* Header strip with kind tint */}
        <div
          style={{
            padding: "12px 14px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            background: `linear-gradient(135deg, ${tint}0e, transparent 65%)`,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <div style={{ width: 22, height: 22, borderRadius: 6, background: `${tint}18`, display: "grid", placeItems: "center" }}>
            <Icon size={11} color={tint} />
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: tint }}>
            {label}
          </div>
        </div>

        {/* Title */}
        <div style={{ padding: "14px 16px 8px" }}>
          <div className="ea-display" style={{ fontSize: 15, fontWeight: 500, color: "#fff", lineHeight: 1.3, letterSpacing: -0.2 }}>
            {title}
          </div>
        </div>

        {/* Meta */}
        <div style={{ padding: "4px 16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <InfoRow label={isBill ? "Due" : "When"} value={whenValue} />
          {isBill
            ? <InfoRow label="Amount" value={amountValue} />
            : <InfoRow label="Where" value={item.location || item.subtitle} />}
          {isBill && item.payee ? <InfoRow label="Payee" value={item.payee} /> : null}
        </div>

        {/* Action */}
        <div
          style={{
            padding: "10px 14px 14px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex", flexWrap: "wrap", gap: 6,
          }}
        >
          <OpenInCalendarButton accent={accent} onClick={onOpenInCalendar} />
        </div>
      </div>
    </BottomSheet>
  );
}
