/* eslint-disable react-refresh/only-export-components */
import { DEADLINE_COLOR, deadlineItemsFromData, getDayState, normalizeStatus } from "./deadlinesModel.ts";
import type { DeadlinesData } from "./deadlinesModel";

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}60`,
        }}
      />
      {label}
    </span>
  );
}

export function renderDeadlinesFooter({ viewYear, viewMonth, currentYear, currentMonth, todayDate, itemsByDay, data }: {
  viewYear: number;
  viewMonth: number;
  currentYear: number;
  currentMonth: number;
  todayDate: number;
  itemsByDay: Record<string, unknown>;
  data?: DeadlinesData | null;
}) {
  const total = Object.values(itemsByDay).reduce<number>((sum, day) => sum + getDayState(day).totalCount, 0);
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;

  let dueToday = 0;
  let dueThisWeek = 0;
  if (isCurrentMonth) {
    const allItems = deadlineItemsFromData(data);
    const today = new Date(currentYear, currentMonth, todayDate);
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    for (const task of allItems) {
      if (normalizeStatus(task.status) === "complete" || !task.due_date) continue;
      const due = new Date(`${task.due_date}T00:00:00`);
      if (Number.isNaN(due.getTime())) continue;
      if (due.getTime() === today.getTime()) dueToday += 1;
      if (due >= weekStart && due <= weekEnd) dueThisWeek += 1;
    }
  }

  const StatRow = ({ value, label }: { value: number; label: string }) => (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{label}</span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: "#fff",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.2,
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {isCurrentMonth && <StatRow value={dueToday} label="Due today" />}
      {isCurrentMonth && <StatRow value={dueThisWeek} label="Due this week" />}
      <StatRow value={total} label="Total this month" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8 }}>
        <LegendDot color={DEADLINE_COLOR} label="Deadline" />
      </div>
    </div>
  );
}
