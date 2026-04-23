import { getCalendarViewMeta } from "../calendarEmptyStateMeta.js";

const PLACEHOLDER_GROUPS = [
  [
    { width: "62%", accentToday: 40, accent: 30, base: "rgba(255,255,255,0.05)" },
    { width: "44%", accentToday: 22, accent: 14, base: "rgba(205,214,244,0.12)" },
  ],
  [
    { width: "55%", accentToday: 18, accent: 10, base: "rgba(205,214,244,0.09)" },
    { width: "36%", accentToday: 12, accent: 7, base: "rgba(205,214,244,0.07)" },
  ],
  [
    { width: "48%", accentToday: 10, accent: 5, base: "rgba(205,214,244,0.06)" },
    { width: "28%", accentToday: 7, accent: 4, base: "rgba(205,214,244,0.05)" },
  ],
  [
    { width: "40%", accentToday: 6, accent: 3, base: "rgba(205,214,244,0.04)" },
    { width: "22%", accentToday: 4, accent: 2, base: "rgba(205,214,244,0.035)" },
  ],
];

function SelectedEmptyPlaceholder({ accent, isToday }) {
  return (
    <div
      data-testid="calendar-selected-empty-cell-placeholder"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        paddingTop: 2,
      }}
    >
      {PLACEHOLDER_GROUPS.map((group, gi) => (
        <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {group.map((bar, bi) => (
            <div
              key={bi}
              style={{
                height: 3,
                width: bar.width,
                borderRadius: 999,
                background: `color-mix(in srgb, ${accent} ${isToday ? bar.accentToday : bar.accent}%, ${bar.base})`,
              }}
            />
          ))}
        </div>
      ))}
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
        width: "100%",
        minHeight: 0,
        padding: "4px 5px 3px",
        borderRadius: 6,
        border: `1px solid color-mix(in srgb, ${meta.accent} ${isToday ? 24 : 16}%, rgba(255,255,255,0.05))`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${meta.accent} ${isToday ? 14 : 8}%, rgba(255,255,255,0.015)), rgba(255,255,255,0.014))`,
        boxShadow: `inset 0 1px 0 color-mix(in srgb, ${meta.accent} ${isToday ? 18 : 12}%, rgba(255,255,255,0.03))`,
        opacity: isPast ? 0.84 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        overflow: "hidden",
        flex: "1 1 0",
        alignSelf: "stretch",
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
            width: 4,
            height: 4,
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
