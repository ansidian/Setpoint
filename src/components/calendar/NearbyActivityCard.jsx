import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  findNeighborDays,
  formatNeighborDate,
  neighborActiveCount,
} from "./calendarOverviewModel.js";

function NeighborRow({
  direction,
  label,
  day,
  items,
  activeView,
  noun,
  accent,
  viewYear,
  viewMonth,
  onSelectDay,
  compact = false,
}) {
  const hasDay = Number.isFinite(day);
  const Icon = direction === "prev" ? ArrowLeft : ArrowRight;
  const dateLabel = hasDay ? formatNeighborDate(viewYear, viewMonth, day) : null;
  const { active } = hasDay
    ? neighborActiveCount(activeView, items)
    : { active: 0 };
  const countLabel = hasDay
    ? `${active} ${active === 1 ? noun : `${noun}s`}`
    : null;

  return (
    <button
      type="button"
      data-testid={`calendar-empty-rail-neighbor-${direction}`}
      disabled={!hasDay}
      onClick={hasDay ? () => onSelectDay?.(day) : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 8 : 10,
        width: "100%",
        padding: compact ? "8px 10px" : "10px 12px",
        borderRadius: 9,
        border: hasDay
          ? `1px solid color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.05))`
          : "1px dashed rgba(255,255,255,0.06)",
        background: hasDay
          ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 6%, rgba(255,255,255,0.02)), rgba(255,255,255,0.012))`
          : "rgba(255,255,255,0.012)",
        cursor: hasDay ? "pointer" : "default",
        opacity: hasDay ? 1 : 0.6,
        fontFamily: "inherit",
        textAlign: "left",
        transition: "background 140ms, border-color 140ms, transform 140ms",
      }}
    >
      <span
        aria-hidden
        style={{
          width: compact ? 22 : 24,
          height: compact ? 22 : 24,
          borderRadius: compact ? 6 : 7,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          color: hasDay ? accent : "rgba(205,214,244,0.4)",
          background: hasDay
            ? `color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.02))`
            : "rgba(255,255,255,0.02)",
          border: hasDay
            ? `1px solid color-mix(in srgb, ${accent} 22%, rgba(255,255,255,0.05))`
            : "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <Icon size={compact ? 12 : 13} strokeWidth={2} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 2 : 3, minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: compact ? 9 : 9.5,
            fontWeight: 700,
            letterSpacing: 1.6,
            textTransform: "uppercase",
            color: "var(--color-text-faint)",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: compact ? 11.5 : 12.5,
            color: hasDay ? "#eef2ff" : "var(--color-text-faint)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {hasDay ? dateLabel : `Nothing ${label.toLowerCase()}`}
        </div>
      </div>
      {countLabel ? (
        <div
          style={{
            flexShrink: 0,
            fontSize: compact ? 10 : 11,
            fontWeight: 600,
            color: "rgba(205,214,244,0.66)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {countLabel}
        </div>
      ) : null}
    </button>
  );
}

export function NearbyActivityCard({
  model,
  activeView,
  itemsByDay,
  selectedDay,
  viewYear,
  viewMonth,
  onSelectDay,
  compact = false,
}) {
  const { prev, next } = findNeighborDays(itemsByDay, selectedDay);
  const noun = model.itemNoun || "item";
  const isClearMonth = prev === null && next === null;

  return (
    <div
      data-testid="calendar-empty-rail-neighbors"
      style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--color-text-faint)",
        }}
      >
        Nearby activity
      </div>
      <NeighborRow
        direction="prev"
        label="Earlier"
        day={prev}
        items={prev ? itemsByDay[prev] : null}
        activeView={activeView}
        noun={noun}
        accent={model.accent}
        viewYear={viewYear}
        viewMonth={viewMonth}
        onSelectDay={onSelectDay}
        compact={compact}
      />
      <NeighborRow
        direction="next"
        label="Later"
        day={next}
        items={next ? itemsByDay[next] : null}
        activeView={activeView}
        noun={noun}
        accent={model.accent}
        viewYear={viewYear}
        viewMonth={viewMonth}
        onSelectDay={onSelectDay}
        compact={compact}
      />
      {isClearMonth ? (
        <div
          style={{
            padding: compact ? "8px 10px" : "10px 12px",
            borderRadius: 10,
            border: "1px dashed rgba(255,255,255,0.06)",
            fontSize: compact ? 10.5 : 11,
            lineHeight: 1.55,
            color: "var(--color-text-faint)",
          }}
        >
          {compact
            ? "Month is clear both ways. Browse with arrows or click any day."
            : "The month is clear in both directions. Use ←/→ or click any day to browse."}
        </div>
      ) : null}
    </div>
  );
}
