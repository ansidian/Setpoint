import { AnimatePresence } from "motion/react";
import CompletionTransition from "../CompletionTransition";
import "./MobileComingUp.css";
import { useState } from "react";
import { CreditCard, CalendarClock, Circle } from "lucide-react";
import { SectionHeader, EmptyRow } from "../rails/railPrimitives";
import { StatusChip } from "../../shared/StatusChip";
import Tooltip from "../../shared/Tooltip";
import MarkDoneAction from "../MarkDoneAction";
import type { ComingUpRow as ComingUpRowModel } from "./comingUpModel";

// Map buildComingUp short chip keys to the canonical token strings StatusChip expects.
const CHIP_TONE = { rose: "var(--sp-rose)", cream: "var(--sp-cream)", muted: "rgba(205,214,244,0.55)" };

// A single coming-up row. The whole row stays click-to-open (jump to its calendar
// detail). Deadlines also get a "Mark done" action — but coming-up isn't urgent,
// so unlike the needs-you band's filled button this one stays subordinate: a quiet
// compact check button that reveals on hover/focus to the LEFT of the timing chip
// (the chip stays put so its date tooltip reads cleanly). Bills aren't Todoist
// items, so they keep the chip only.
function ComingUpRow({ row, isLast, isMobile = false, onJump, onComplete }: {
  row: ComingUpRowModel;
  isLast: boolean;
  isMobile?: boolean;
  onJump?: (row: ComingUpRowModel, anchor: HTMLElement) => void;
  onComplete?: (row: ComingUpRowModel) => unknown | Promise<unknown>;
}) {
  const [rowHover, setRowHover] = useState(false);
  const completable = row.kind === "deadline" && !!onComplete;
  const ItemIcon = row.kind === "bill" ? CreditCard : Circle;

  if (isMobile) {
    return (
      <div className="mobile-coming-row">
        <button type="button" className="mobile-coming-open dashboard-item-trigger" onClick={(event) => onJump?.(row, event.currentTarget)}>
          <span className="mobile-coming-title">{row.title}</span>
          <span className="mobile-coming-meta"><ItemIcon size={12} aria-hidden="true" />{row.chipLabel} · {row.meta}</span>
        </button>
        {completable && <MarkDoneAction onComplete={() => onComplete(row)} itemTitle={row.title} compact isMobile alwaysVisible />}
      </div>
    );
  }

  return (
    <div
      className="dashboard-item-trigger sp-focus-ring"
      role="button"
      tabIndex={0}
      onClick={(e) => onJump?.(row, e.currentTarget)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onJump?.(row, e.currentTarget); }}
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => setRowHover(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        padding: "9px 0",
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
        cursor: "pointer", transition: "background 150ms ease, transform 150ms cubic-bezier(0.22,1,0.36,1)",
        background: rowHover ? "rgba(255,255,255,0.02)" : "transparent",
      }}
    >
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
        <ItemIcon size={13} color="rgba(205,214,244,0.45)" aria-hidden style={{ flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "rgba(205,214,244,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
          <div style={{ fontSize: 10, color: "rgba(205,214,244,0.4)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{row.meta}</div>
        </div>
      </div>
      {/* The time chip stays put so its hover tooltip reads cleanly; a compact
          check button fades in to its LEFT on hover (completable deadlines only),
          its 20px slot reserved so nothing shifts. No crossfade, no overlap. */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, height: 20, minWidth: completable ? 88 : undefined }}>
        {completable && (
          <MarkDoneAction
            onComplete={() => onComplete(row)}
            revealed={rowHover}
            alwaysVisible={isMobile}
            itemTitle={row.title}
            compact
          />
        )}
        <Tooltip text={row.chipTooltip}>
          <StatusChip label={row.chipLabel} tone={CHIP_TONE[row.chipTone] || CHIP_TONE.muted} />
        </Tooltip>
      </div>
    </div>
  );
}

export default function ComingUpCard({ items = [], isMobile = false, onJump, onComplete }: {
  items?: ComingUpRowModel[];
  isMobile?: boolean;
  onJump?: (row: ComingUpRowModel, anchor: HTMLElement) => void;
  onComplete?: (row: ComingUpRowModel) => unknown | Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const visible = items.filter((row) => !completedIds.includes(row.id));
  const displayed = isMobile && !expanded ? visible.slice(0, 3) : visible;

  const handleComplete = onComplete
    ? async (row: ComingUpRowModel) => {
      setCompletedIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
      try {
        const result = await onComplete(row);
        if (result === false) throw new Error("Completion failed");
        setActionError(null);
      } catch {
        setCompletedIds((prev) => prev.filter((id) => id !== row.id));
        setActionError("Couldn't mark done. Try again.");
      }
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
      <SectionHeader isMobile={isMobile} title="Coming up" right={<div style={{ fontSize: 10, color: "rgba(205,214,244,0.4)" }}>Next 7 days</div>} />
      <div style={{ marginTop: 6 }}>
        <AnimatePresence initial={false} custom={completedIds}>
          {displayed.map((row, i) => (
            <CompletionTransition key={row.id} itemId={row.id}>
            <ComingUpRow
              row={row}
              isLast={i === displayed.length - 1}
              isMobile={isMobile}
              onJump={onJump}
              onComplete={handleComplete}
            />
            </CompletionTransition>
          ))}
        </AnimatePresence>
        {isMobile && visible.length > 3 && (
          <button type="button" className="mobile-coming-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show less" : `View all ${visible.length} upcoming items`}
          </button>
        )}
        {actionError && <p role="status" style={{ color: "var(--sp-rose)", fontSize: 12 }}>{actionError}</p>}
        {visible.length === 0 && <EmptyRow icon={CalendarClock} label="Nothing in the next 7 days" />}
      </div>
    </div>
  );
}
