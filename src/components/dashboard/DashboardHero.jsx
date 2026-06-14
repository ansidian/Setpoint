import { memo, useEffect, useMemo, useState } from "react";
import { CheckCircle, CalendarPlus } from "lucide-react";
import { greetingFor } from "../../lib/shell-helpers";
import { deriveFocusWindows } from "../../lib/focus-windows";
import { deriveOpenDaySummary } from "../../lib/open-day-summary";
import HeroCalloutCard from "./hero/HeroCalloutCard";
import HeroContextRail from "./hero/HeroContextRail";
import {
  buildHeroCallouts,
  WEATHER_ICONS,
} from "./hero/dashboard-hero-helpers";
import HeroMessageBlock from "./hero/HeroMessageBlock";

function HeroQuickActionButton({ accent, isMobile, item, onQuickAction }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;
  const Icon = item.icon;

  return (
    <button
      type="button"
      key={item.action}
      onClick={() => onQuickAction?.(item.action)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: isMobile ? "7px 12px" : "7px 14px",
        borderRadius: 999,
        background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.045)",
        border: `1px solid ${active ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.1)"}`,
        color: "#cdd6f4",
        fontSize: isMobile ? 12 : 13,
        fontWeight: 500,
        cursor: "pointer",
        outline: focused ? `2px solid ${accent}55` : "none",
        outlineOffset: 2,
        transform: active ? "translateY(-1px)" : "translateY(0)",
        transition: "background 150ms ease, border-color 150ms ease, transform 150ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <Icon size={isMobile ? 14 : 16} color={accent} />
      {item.label}
    </button>
  );
}

/**
 * DashboardHero — the single most-important block on the Dashboard.
 * Large serif greeting + AI state-of-day + weather/focus band + 3-up callouts.
 *
 * Wrapped in React.memo so the 2s poll loop / SSE refetch / 5-min refresh do not
 * re-render the hero unless its (now reference-stable) data props actually change.
 */
function DashboardHero({
  accent = "#cba6da",
  density = "comfortable",
  stack = false,
  isMobile = false,
  briefing,
  liveWeather,
  liveCalendar,
  liveDeadlines,
  liveBills,
  userName = "",
  onJump,
  onQuickAction,
  onOpenPressure,
  eventLoadingState = "ready",
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Coarser clock for the Intl-heavy derivations: they all emit minute-granular
  // labels/windows, so flooring to the minute means the 2x/min 30s tick no longer
  // re-runs buildHeroCallouts/deriveFocusWindows/deriveOpenDaySummary on a raw-ms
  // change that produces an identical result. Raw `now` is kept for the live time
  // string (greet + HeroMessageBlock) which legitimately ticks every 30s.
  const coarseNow = useMemo(() => Math.floor(now / 60000) * 60000, [now]);

  const greet = greetingFor(new Date(now), userName);
  const weather = liveWeather || briefing?.weather;
  const events = useMemo(
    () => liveCalendar || [],
    [liveCalendar],
  );
  const deadlines = useMemo(() => {
    if (liveDeadlines) return liveDeadlines;
    return [];
  }, [liveDeadlines]);
  const bills = useMemo(() => liveBills || [], [liveBills]);

  const theCallouts = useMemo(
    () => buildHeroCallouts({ events, deadlines, bills, now: coarseNow }),
    [events, deadlines, bills, coarseNow],
  );
  const focusWindows = useMemo(
    () => deriveFocusWindows({ events, deadlines, now: coarseNow }),
    [events, deadlines, coarseNow],
  );
  const openDaySummary = useMemo(
    () => deriveOpenDaySummary({ deadlines, bills, emails: null, now: coarseNow }),
    [deadlines, bills, coarseNow],
  );

  const compact = density === "compact";
  const stacked = stack || isMobile;
  const outerPadding = isMobile
    ? "12px 14px 10px"
    : compact ? "9px 16px 8px" : "10px 18px 9px";
  const WeatherIcon = (weather?.icon && WEATHER_ICONS[weather.icon]) || WEATHER_ICONS.Sun;
  const quickActions = [
    { label: "New Deadline", icon: CheckCircle, action: "deadline" },
    { label: "Add Event", icon: CalendarPlus, action: "event" },
  ];
  const hasCallouts = theCallouts.length > 0;
  const desktopColumns = hasCallouts
    ? "minmax(210px, 0.72fr) minmax(250px, 0.82fr) minmax(320px, 1fr)"
    : "minmax(0, 1fr) minmax(260px, 0.72fr)";

  return (
    <div
      data-testid={isMobile ? "dashboard-hero-mobile" : "dashboard-hero"}
      style={{
        padding: outerPadding,
        position: "relative",
        overflow: "hidden",
        margin: isMobile ? "0" : "6px 0 0",
        borderRadius: isMobile ? 0 : 14,
        border: isMobile ? "none" : "1px solid rgba(255,255,255,0.06)",
        background: isMobile
          ? "transparent"
          : "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: stacked ? "1fr" : desktopColumns,
          gap: stacked ? (isMobile ? 10 : 12) : 16,
          alignItems: "stretch",
          position: "relative",
        }}
      >
        <div
          data-testid="dashboard-hero-primary"
          style={{
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            gap: isMobile ? 10 : 12,
          }}
        >
          <HeroMessageBlock
            accent={accent}
            compact={compact}
            greet={greet}
            isMobile={isMobile}
            now={now}
          />

          <div
            data-testid="dashboard-hero-actions"
            style={{
              display: "flex",
              gap: isMobile ? 8 : 10,
              flexWrap: "wrap",
              position: "relative",
              zIndex: 10,
            }}
          >
            {quickActions.map((item) => (
              <HeroQuickActionButton
                key={item.action}
                accent={accent}
                isMobile={isMobile}
                item={item}
                onQuickAction={onQuickAction}
              />
            ))}
          </div>
        </div>

        <HeroContextRail
          accent={accent}
          eventLoadingState={eventLoadingState}
          focusWindows={focusWindows}
          isMobile={isMobile}
          onOpenPressure={onOpenPressure}
          openDaySummary={openDaySummary}
          stacked={stacked}
          weather={weather}
          weatherIcon={WeatherIcon}
          compact={!stacked}
        />

        {hasCallouts && (
          <div
            data-testid="dashboard-hero-callouts"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 0,
              marginTop: stacked ? (isMobile ? 8 : compact ? 8 : 10) : 0,
              position: "relative",
              paddingTop: stacked ? (isMobile ? 2 : 6) : 0,
              paddingLeft: !stacked && !isMobile ? 16 : 0,
              borderTop: stacked ? "1px solid rgba(255,255,255,0.05)" : "none",
              borderLeft: !stacked && !isMobile ? "1px solid rgba(255,255,255,0.06)" : "none",
              minWidth: 0,
            }}
          >
            {theCallouts.map((c, i) => (
              <div
                key={i}
                style={{
                  minWidth: 0,
                  padding: isMobile
                    ? "0"
                    : stacked
                      ? i === 0 ? "0 16px 0 0" : "0 16px"
                      : i === 0 ? "0 0 6px" : "7px 0 6px",
                  borderLeft: !isMobile && stacked && i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  borderTop: (isMobile && i > 0) || (!stacked && !isMobile && i > 0) ? "1px solid rgba(255,255,255,0.05)" : "none",
                }}
              >
                <HeroCalloutCard
                  {...c}
                  accent={accent}
                  isMobile={isMobile}
                  onJump={(anchor) => onJump?.(c, anchor)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(DashboardHero);
