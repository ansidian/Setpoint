import { createElement } from "react";
import { resolveIcon } from "../../../../lib/icons.js";

export function WeatherHeader({ weather }) {
  if (!weather) return null;
  const WeatherIcon = resolveIcon(weather.icon);
  return (
    <div
      aria-label={weather.summary || "Weather"}
      title={weather.summary || "Weather"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: "rgba(205,214,244,0.72)",
        fontSize: 10,
        fontWeight: 650,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {WeatherIcon ? createElement(WeatherIcon, { size: 13, strokeWidth: 1.9, "aria-hidden": "true" }) : null}
      {weather.high != null || weather.low != null ? (
        <span>{weather.high ?? "--"}°/{weather.low ?? "--"}°</span>
      ) : null}
    </div>
  );
}

export function AgendaSkeleton() {
  return (
    <div
      data-testid="calendar-events-rail-skeleton"
      style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}
    >
      {[0, 1, 2, 3].map((index) => (
        <div key={index} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ width: index % 2 ? "64%" : "78%", height: 30, borderRadius: 8, background: "rgba(255,255,255,0.055)" }} />
          <div style={{ width: "100%", height: 48, borderRadius: 8, background: "rgba(255,255,255,0.035)" }} />
        </div>
      ))}
    </div>
  );
}
