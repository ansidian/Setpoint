import { Skeleton } from "@/components/ui/skeleton";
import { GRID_ROWS } from "./calendarGridUtils.js";

export default function CalendarGridSkeleton({
  firstDay,
  daysInMonth,
  trailingEmpty,
  cellHeight,
  gridGap,
  fillHeight,
  rowCount,
}) {
  const rowWidths = cellHeight >= 96 ? ["84%", "71%", "58%"] : ["86%", "63%"];

  return (
    <div
      data-testid="calendar-grid-skeleton"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gridTemplateRows: fillHeight
          ? `repeat(${rowCount}, minmax(0, 1fr))`
          : `repeat(${GRID_ROWS}, ${cellHeight}px)`,
        gap: gridGap,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: firstDay }, (_, index) => <div key={`sk-empty-${index}`} />)}
      {Array.from({ length: daysInMonth }, (_, index) => (
        <div
          key={`sk-day-${index}`}
          style={{
            padding: "28px 9px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 5,
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {rowWidths.map((width, rowIndex) => (
              <Skeleton
                key={rowIndex}
                className="h-[10px] rounded-sm bg-white/8"
                style={{ width, opacity: rowIndex === rowWidths.length - 1 ? 0.72 : 1 }}
              />
            ))}
          </div>
        </div>
      ))}
      {Array.from({ length: trailingEmpty }, (_, index) => <div key={`sk-trail-${index}`} />)}
    </div>
  );
}
