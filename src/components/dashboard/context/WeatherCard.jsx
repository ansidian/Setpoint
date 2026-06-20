import { Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, CloudSnow, CloudLightning, CloudFog, Wind, Tornado } from "lucide-react";

// The canonical icon-name set the SERVER emits (server/platform/weather.js
// ICON_MAP values), inlined so WeatherCard does not depend on the hero/ tree
// (deleted in Task 22) and does NOT inherit the hero map's bugs (Snowflake →
// should be CloudSnow; missing CloudMoon/CloudLightning/Tornado). Sun is the
// fallback (matches the server's getIcon fallback).
const WEATHER_ICONS = { Sun, Moon, CloudRain, CloudSnow, Wind, CloudFog, Cloud, CloudSun, CloudMoon, CloudLightning, Tornado };

export default function WeatherCard({ weather }) {
  const Icon = (weather?.icon && WEATHER_ICONS[weather.icon]) || WEATHER_ICONS.Sun;
  const temp = weather?.temp != null ? `${Math.round(weather.temp)}°` : "—";
  const hi = weather?.high != null ? `H ${Math.round(weather.high)}°` : null;
  const lo = weather?.low != null ? `L ${Math.round(weather.low)}°` : null;
  const day = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" });
  const hl = [hi, lo, day].filter(Boolean).join(" · ");

  return (
    <div
      data-testid="context-weather"
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 12,
        padding: "15px 17px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.005))",
        border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14,
      }}
    >
      <span style={{ fontSize: 30, fontWeight: 600, color: "#dfe5f7", lineHeight: 1, flexShrink: 0 }}>{temp}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "rgba(205,214,244,0.6)", lineHeight: 1.35 }}>{weather?.summary || ""}</div>
        <div style={{ fontSize: 11, color: "rgba(205,214,244,0.45)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{hl}</div>
      </div>
      <Icon size={30} strokeWidth={1.8} color="var(--sp-cream, #f9e2af)" style={{ flexShrink: 0 }} />
    </div>
  );
}
