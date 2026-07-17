import { useState } from "react";
import { useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { Icon } from "../../../lib/Icon";
import { buildForecastHours, buildForecastDays, currentCondition } from "./weatherCardModel";
import type { CSSProperties, DOMAttributes } from "react";
import type { DashboardWeather } from "./weatherCardModel";

// Icons resolve through the canonical ICON_BY_NAME registry (the same names the
// server emits for weather); Icon uses createElement so the dynamic lookup
// doesn't trip react-hooks/static-components.
const ACCENT = "var(--sp-accent)"; // lavender — reserved for the current hour only
const PRIMARY = "#dfe5f7";
const FAINT = "rgba(205,214,244,0.4)";
const MICRO_LABEL: CSSProperties = { fontSize: 9.5, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.42)" };

export default function WeatherCard({ weather }: { weather?: DashboardWeather | null }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  // Coarse pointers can't hover, so the same disclosure toggles on tap instead.
  const [coarse] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(hover: none)").matches);

  const temp = weather?.temp != null ? `${Math.round(weather.temp)}°` : "—";
  const condition = currentCondition(weather);
  const hi = weather?.high != null ? `H ${Math.round(weather.high)}°` : null;
  const lo = weather?.low != null ? `L ${Math.round(weather.low)}°` : null;
  const day = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" });
  const meta = [hi, lo, day].filter(Boolean).join(" · ");

  const hours = buildForecastHours(weather);
  const days = buildForecastDays(weather);
  const hasForecast = hours.length > 0 || days.length > 0;

  // Only the interactive (has-forecast) card opens; otherwise it degrades to a
  // quiet static card with no affordance.
  const interaction: DOMAttributes<HTMLDivElement> & { tabIndex?: number } = !hasForecast
    ? {}
    : coarse
      ? { onClick: () => setOpen((o) => !o) }
      : {
          onMouseEnter: () => setOpen(true),
          onMouseLeave: () => setOpen(false),
          onFocus: () => setOpen(true),
          onBlur: () => setOpen(false),
          tabIndex: 0,
        };

  return (
    <div
      data-testid="context-weather"
      data-open={hasForecast ? open : undefined}
      aria-expanded={hasForecast ? open : undefined}
      aria-label={hasForecast ? "Weather — hover or focus for the forecast" : undefined}
      {...interaction}
      style={{
        flex: "none",
        padding: "15px 17px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.005))",
        border: `1px solid rgba(255,255,255,${open ? 0.12 : 0.06})`,
        borderRadius: 14,
        cursor: hasForecast && coarse ? "pointer" : "default",
        outline: "none",
        transition: `border-color ${reduce ? 0 : 200}ms ease`,
      }}
    >
      {/* ── Resting header (always visible) ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 600, color: PRIMARY, lineHeight: 1 }}>{temp}</span>
            {condition && <span style={{ fontSize: 12, color: "rgba(205,214,244,0.6)" }}>{condition}</span>}
          </div>
          {meta && (
            <div style={{ fontSize: 11, color: "rgba(205,214,244,0.45)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{meta}</div>
          )}
        </div>
        <Icon name={weather?.icon || "Sun"} size={30} strokeWidth={1.8} color="var(--sp-cream, #f9e2af)" style={{ flexShrink: 0 }} />
      </div>

      {hasForecast && (
        <>
          {/* ── Expansion (revealed on hover/focus/tap) ── */}
          <div
            style={{
              maxHeight: open ? 360 : 0,
              opacity: open ? 1 : 0,
              overflow: "hidden",
              transition: reduce ? "none" : "max-height 340ms cubic-bezier(0.16,1,0.3,1), opacity 240ms ease",
            }}
          >
            <div style={{ marginTop: 15, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {hours.length > 0 && (
                <>
                  <div style={{ ...MICRO_LABEL, marginBottom: 13 }}>Rest of today</div>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 4 }}>
                    {hours.map((h, i) => {
                      const accent = h.now ? ACCENT : null;
                      return (
                        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: accent || PRIMARY }}>{h.temp}</div>
                          <Icon name={h.iconName} size={16} strokeWidth={2} color={accent || h.color} />
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontVariantNumeric: "tabular-nums", color: accent || FAINT }}>{h.time}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {days.length > 0 && (
                <>
                  <div style={{ ...MICRO_LABEL, margin: "18px 0 4px" }}>Next 3 days</div>
                  {days.map((d, i) => (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "38px 1fr auto",
                        gap: 10,
                        alignItems: "center",
                        padding: "9px 0",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: "rgba(205,214,244,0.7)" }}>{d.name}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <Icon name={d.iconName} size={15} strokeWidth={2} color={d.color} style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, color: "rgba(205,214,244,0.6)", whiteSpace: "nowrap" }}>{d.cond}</span>
                        {d.rain && (
                          <span style={{ fontSize: 9.5, fontWeight: 600, color: "var(--sp-blue)", fontVariantNumeric: "tabular-nums" }}>{d.rain}</span>
                        )}
                      </span>
                      <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                        <b style={{ color: PRIMARY, fontWeight: 600 }}>{d.hi}</b> <span style={{ color: FAINT }}>{d.lo}</span>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* ── Hint (rest only) ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              letterSpacing: 0.3,
              color: "rgba(205,214,244,0.34)",
              maxHeight: open ? 0 : 26,
              opacity: open ? 0 : 1,
              marginTop: open ? 0 : 12,
              overflow: "hidden",
              transition: reduce ? "none" : "all 220ms ease",
            }}
          >
            <ChevronDown size={12} strokeWidth={2} color="rgba(205,214,244,0.34)" />
            <span>{coarse ? "Tap for the forecast" : "Hover for the forecast"}</span>
          </div>
        </>
      )}
    </div>
  );
}
