import { getOverviewModel } from "./calendarOverviewModel.js";
import {
  EventsLoadingFrame,
  MetricCard,
} from "./CalendarRailPrimitives.jsx";
import { railContentStyle, railStaticStyle } from "./calendarRailStyles.js";

export function CalendarOverviewRail(props) {
  const model = getOverviewModel(props);

  return (
    <div data-testid="calendar-overview-rail-frame" style={railStaticStyle()}>
      <div style={{ ...railContentStyle({ compact: true }), justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 14,
              border: `1px solid color-mix(in srgb, ${model.accent} 16%, rgba(255,255,255,0.05))`,
              background: `radial-gradient(circle at top left, color-mix(in srgb, ${model.accent} 12%, transparent), transparent 50%), linear-gradient(180deg, rgba(255,255,255,0.032), rgba(255,255,255,0.018))`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "rgba(205,214,244,0.48)",
              }}
            >
              Month navigator
            </div>
            <div className="ea-display" style={{ fontSize: 22, lineHeight: 1.02, letterSpacing: -0.36, color: "#f5f7ff" }}>
              {model.title}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(205,214,244,0.58)" }}>
              Browse the month from here while the right rail follows the selected day.
            </div>
          </div>

          {props.view === "events" && props.data?.isLoading ? (
            <EventsLoadingFrame />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, flexShrink: 0 }}>
              {model.stats.map((stat) => (
                <MetricCard
                  key={stat.label}
                  {...stat}
                  accent={model.accent}
                  compact
                />
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.05)",
            background: "rgba(255,255,255,0.018)",
            fontSize: 11,
            lineHeight: 1.52,
            color: "rgba(205,214,244,0.54)",
            flexShrink: 0,
          }}
        >
          Click a day, use `T` to jump back to today, and keep the month visible while the right stage becomes the navigator.
        </div>
      </div>
    </div>
  );
}
