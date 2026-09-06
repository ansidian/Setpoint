import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { CalendarClock, ChevronDown } from "lucide-react";
import CompletionTransition from "../CompletionTransition";
import AnimatedHeight from "../../shared/AnimatedHeight";
import { SectionHeader, EmptyRow } from "../rails/railPrimitives";
import MarkDoneAction from "../MarkDoneAction";
import type { ComingUpRow } from "./comingUpModel";
import "./MobileComingUp.css";

function occurrenceKey(row: ComingUpRow) {
  return row.occurrenceKey || row.id;
}

function dayLabel(row: ComingUpRow) {
  if (row.sortDays === 1) return "Tomorrow";
  if (!row.date) return row.chipLabel;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${row.date}T12:00:00Z`));
}

export default function ComingUpCard({ items = [], isMobile = false, onJump, onComplete }: {
  items?: ComingUpRow[];
  isMobile?: boolean;
  onJump?: (row: ComingUpRow, anchor: HTMLElement) => void;
  onComplete?: (row: ComingUpRow) => unknown | Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const groups = new Map<string, ComingUpRow[]>();
  for (const row of items) {
    if (row.kind !== "deadline" || (row.sortDays != null && (row.sortDays < 1 || row.sortDays > 7))) continue;
    const key = row.date || String(row.sortDays);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const days = [...groups.entries()];
  const displayedDays = expanded ? days : days.slice(0, 3);

  const handleComplete = onComplete
    ? async (row: ComingUpRow) => {
      const key = occurrenceKey(row);
      setCompletedIds((prev) => prev.includes(key) ? prev : [...prev, key]);
      try {
        const result = await onComplete(row);
        if (result === false) throw new Error("Completion failed");
        setActionError(null);
      } catch {
        setCompletedIds((prev) => prev.filter((id) => id !== key));
        setActionError("Couldn't mark done. Try again.");
      }
    }
    : undefined;

  return (
    <section data-testid="context-coming-up" className={`dashboard-ahead${isMobile ? " dashboard-ahead--mobile" : ""}`}>
      <SectionHeader isMobile={isMobile} title="Ahead" right={<span className="dashboard-ahead-horizon">Next 7 days</span>} />
      <AnimatedHeight>
        <div className="dashboard-ahead-days">
          {displayedDays.map(([day, rows]) => {
            const visible = rows.filter((row) => !completedIds.includes(occurrenceKey(row)));
            const dayExpanded = expandedDays.includes(day);
            const displayed = dayExpanded ? visible : visible.slice(0, 1);
            return (
              <div key={day} className="dashboard-ahead-day">
                <div className="dashboard-ahead-date">{dayLabel(rows[0]!)}</div>
                <div className="dashboard-ahead-content">
                  <AnimatePresence initial={false} custom={completedIds}>
                    {displayed.map((row) => (
                      <CompletionTransition key={occurrenceKey(row)} itemId={occurrenceKey(row)}>
                        <div className="dashboard-ahead-row">
                          <button type="button" className="dashboard-ahead-open" onClick={(event) => onJump?.(row, event.currentTarget)}>
                            <span className="dashboard-ahead-title">{row.title}</span>
                            <span className="dashboard-ahead-meta">{row.time ? `${row.time} · ` : ""}{row.meta}</span>
                          </button>
                          {handleComplete && <MarkDoneAction onComplete={() => void handleComplete(row)} itemTitle={row.title} compact isMobile={isMobile} alwaysVisible />}
                        </div>
                      </CompletionTransition>
                    ))}
                  </AnimatePresence>
                  {visible.length > 1 && <button type="button" className="dashboard-ahead-toggle" aria-expanded={dayExpanded}
                    aria-label={`${dayExpanded ? "Collapse" : "Show all"} deadlines for ${dayLabel(rows[0]!)}`}
                    onClick={() => setExpandedDays((previous) => dayExpanded ? previous.filter((value) => value !== day) : [...previous, day])}>
                    {dayExpanded ? "Show less" : `+${visible.length - 1} more`}<ChevronDown size={12} aria-hidden="true" style={{ transform: dayExpanded ? "rotate(180deg)" : undefined }} />
                  </button>}
                </div>
              </div>
            );
          })}
          {days.length > 3 && <button type="button" className="dashboard-ahead-toggle dashboard-ahead-week" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show fewer days" : "View week"}<ChevronDown size={12} aria-hidden="true" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
          </button>}
          {actionError && <p role="status" className="dashboard-ahead-error">{actionError}</p>}
          {days.length === 0 && <EmptyRow icon={CalendarClock} label="No deadlines in the next 7 days" />}
        </div>
      </AnimatedHeight>
    </section>
  );
}
