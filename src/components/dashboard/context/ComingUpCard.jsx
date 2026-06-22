import { useState } from "react";
import { CreditCard, CalendarClock } from "lucide-react";
import { SectionHeader, EmptyRow } from "../rails/railPrimitives.jsx";
import { StatusChip } from "../../shared/StatusChip.jsx";
import MarkDoneAction from "../MarkDoneAction.jsx";

// Map buildComingUp short chip keys to the canonical token strings StatusChip expects.
const CHIP_TONE = { rose: "var(--sp-rose)", cream: "var(--sp-cream)", muted: "rgba(205,214,244,0.55)" };

// A single coming-up row. The whole row stays click-to-open (jump to its calendar
// detail). Deadlines also get a "Mark done" action — but coming-up isn't urgent,
// so unlike the needs-you band's filled button this one stays subordinate: a quiet
// ghost control that reveals on hover/focus and crossfades with the timing chip in
// a shared slot, so the resting list stays calm and the layout never shifts. Bills
// aren't Todoist items, so they keep the chip only.
function ComingUpRow({ row, isLast, onJump, onComplete }) {
  const [rowHover, setRowHover] = useState(false);
  const completable = row.kind === "deadline" && !!onComplete;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onJump?.(row)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onJump?.(row); }}
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => setRowHover(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        padding: "9px 0",
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
        cursor: "pointer", transition: "background 150ms",
        background: rowHover ? "rgba(255,255,255,0.02)" : "transparent",
      }}
    >
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
        {row.kind === "bill" && <CreditCard size={13} color="rgba(205,214,244,0.45)" aria-hidden />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "rgba(205,214,244,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
          <div style={{ fontSize: 10, color: "rgba(205,214,244,0.4)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{row.meta}</div>
        </div>
      </div>
      {/* Chip at rest, quiet text-only "Mark done" on hover/focus — crossfaded in
          one fixed slot so there's no layout shift and no button box to clip. */}
      <div style={{ position: "relative", flex: "none", display: "flex", alignItems: "center", justifyContent: "flex-end", height: 20, minWidth: completable ? 76 : undefined }}>
        <span style={{ opacity: completable && rowHover ? 0 : 1, transition: "opacity 130ms ease", pointerEvents: "none" }}>
          <StatusChip label={row.chipLabel} tone={CHIP_TONE[row.chipTone] || CHIP_TONE.muted} />
        </span>
        {completable && (
          <MarkDoneAction
            onComplete={() => onComplete(row)}
            revealed={rowHover}
            itemTitle={row.title}
            style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)" }}
          />
        )}
      </div>
    </div>
  );
}

export default function ComingUpCard({ items = [], onJump, onComplete }) {
  // Optimistically hide a just-completed deadline so it leaves instantly, before
  // the dashboard refetch drops it from the feed (mirrors the needs-you band).
  // No completer wired (e.g. mobile) => no action affordance at all.
  const [completedIds, setCompletedIds] = useState([]);
  const visible = items.filter((row) => !completedIds.includes(row.id));

  const handleComplete = onComplete
    ? (row) => {
      setCompletedIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
      onComplete(row);
    }
    : undefined;

  return (
    <div
      data-testid="context-coming-up"
      style={{
        flex: "none", padding: "15px 17px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.004))",
        border: "1px solid rgba(255,255,255,0.055)", borderRadius: 14,
      }}
    >
      <SectionHeader title="Coming up" right={<div style={{ fontSize: 10, color: "rgba(205,214,244,0.4)" }}>Next 7 days</div>} />
      <div style={{ marginTop: 6 }}>
        {visible.map((row, i) => (
          <ComingUpRow
            key={row.id}
            row={row}
            isLast={i === visible.length - 1}
            onJump={onJump}
            onComplete={handleComplete}
          />
        ))}
        {visible.length === 0 && <EmptyRow icon={CalendarClock} label="Nothing in the next 7 days" />}
      </div>
    </div>
  );
}
