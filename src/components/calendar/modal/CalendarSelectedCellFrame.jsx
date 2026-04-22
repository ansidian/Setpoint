import { getCalendarViewMeta } from "../calendarEmptyStateMeta.js";

function SelectedEmptyPlaceholder({ accent, isToday }) {
  return (
    <div
      data-testid="calendar-selected-empty-cell-placeholder"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        paddingTop: 4,
      }}
    >
      <div
        style={{
          height: 3,
          width: "62%",
          borderRadius: 999,
          background: `color-mix(in srgb, ${accent} ${isToday ? 40 : 30}%, rgba(255,255,255,0.05))`,
        }}
      />
      <div
        style={{
          height: 3,
          width: "44%",
          borderRadius: 999,
          background: isToday
            ? `color-mix(in srgb, ${accent} 16%, rgba(205,214,244,0.16))`
            : "rgba(205,214,244,0.14)",
        }}
      />
    </div>
  );
}

export default function CalendarSelectedCellFrame({
  view,
  children,
  isEmpty = false,
  pastTone,
  isToday = false,
}) {
  const meta = getCalendarViewMeta(view);
  const isPast = pastTone === "items" || pastTone === "empty";

  if (!isEmpty) {
    return (
      <div
        data-testid="calendar-selected-cell-frame"
        style={{
          position: "relative",
          minHeight: "100%",
          minWidth: 0,
          opacity: isPast ? 0.92 : 1,
          transition: "opacity 150ms",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      data-testid="calendar-selected-cell-frame"
      style={{
        position: "relative",
        minHeight: "100%",
        padding: "5px 6px 4px",
        borderRadius: 6,
        border: `1px solid color-mix(in srgb, ${meta.accent} ${isToday ? 24 : 16}%, rgba(255,255,255,0.05))`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${meta.accent} ${isToday ? 14 : 8}%, rgba(255,255,255,0.015)), rgba(255,255,255,0.014))`,
        boxShadow: `inset 0 1px 0 color-mix(in srgb, ${meta.accent} ${isToday ? 18 : 12}%, rgba(255,255,255,0.03))`,
        opacity: isPast ? 0.84 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        overflow: "hidden",
        transition: "opacity 150ms, border-color 150ms, background 150ms",
      }}
    >
      <div
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            flexShrink: 0,
            background: meta.accent,
            boxShadow: `0 0 6px color-mix(in srgb, ${meta.accent} 34%, transparent)`,
          }}
        />
      </div>

      <div style={{ minHeight: 0, minWidth: 0 }}>
        <SelectedEmptyPlaceholder accent={meta.accent} isToday={isToday} />
      </div>
    </div>
  );
}
