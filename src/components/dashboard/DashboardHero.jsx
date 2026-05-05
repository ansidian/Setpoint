import { useEffect, useMemo, useState } from "react";
import { CheckCircle, CalendarPlus } from "lucide-react";
import { greetingFor } from "../../lib/redesign-helpers";
import { deriveFocusWindows } from "../../lib/focus-windows";
import { deriveOpenDaySummary } from "../../lib/open-day-summary";
import HeroCalloutCard from "./hero/HeroCalloutCard";
import HeroContextRail from "./hero/HeroContextRail";
import {
  buildHeroCallouts,
  WEATHER_ICONS,
} from "./hero/dashboard-hero-helpers";
import HeroMessageBlock from "./hero/HeroMessageBlock";

/**
 * DashboardHero — the single most-important block on the Dashboard.
 * Large serif greeting + AI state-of-day + weather/focus band + 3-up callouts.
 */
export default function DashboardHero({
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
    () => buildHeroCallouts({ events, deadlines, bills, now }),
    [events, deadlines, bills, now],
  );
  const focusWindows = useMemo(
    () => deriveFocusWindows({ events, deadlines, now }),
    [events, deadlines, now],
  );
  const openDaySummary = useMemo(
    () => deriveOpenDaySummary({ deadlines, bills, emails: null, now }),
    [deadlines, bills, now],
  );

  const compact = density === "compact";
  const stacked = stack || isMobile;
  const outerPadding = isMobile
    ? "12px 14px 10px"
    : compact ? "12px 18px 10px" : "14px 20px 12px";
  const WeatherIcon = (weather?.icon && WEATHER_ICONS[weather.icon]) || WEATHER_ICONS.Sun;
  const quickActions = [
    { label: "New Task", icon: CheckCircle, action: "task" },
    { label: "Add Event", icon: CalendarPlus, action: "event" },
  ];

  return (
    <div
      data-testid={isMobile ? "dashboard-hero-mobile" : "dashboard-hero"}
      style={{
        padding: outerPadding,
        position: "relative",
        overflow: "hidden",
        margin: isMobile ? "0" : "8px 0 0",
        borderRadius: isMobile ? 0 : 16,
        border: isMobile ? "none" : "1px solid rgba(255,255,255,0.06)",
        background: isMobile
          ? "transparent"
          : "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: stacked ? "1fr" : "minmax(0, 1fr) 276px",
          gap: stacked ? (isMobile ? 10 : 12) : 18,
          alignItems: "start",
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
              <button
                key={item.action}
                onClick={() => onQuickAction?.(item.action)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: isMobile ? "7px 12px" : "7px 14px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#cdd6f4",
                  fontSize: isMobile ? 12 : 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "background 150ms ease, border-color 150ms ease, transform 150ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <item.icon size={isMobile ? 14 : 16} color={accent} />
                {item.label}
              </button>
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
        />
      </div>

      {theCallouts.length > 0 && (
        <div
          data-testid="dashboard-hero-callouts"
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : `repeat(${theCallouts.length}, 1fr)`,
            gap: 0,
            marginTop: isMobile ? 8 : compact ? 8 : 10,
            position: "relative",
            paddingTop: isMobile ? 2 : 6,
            borderTop: "1px solid rgba(255,255,255,0.05)",
            alignItems: "stretch",
          }}
        >
          {theCallouts.map((c, i) => (
            <div
              key={i}
              style={{
                minWidth: 0,
                padding: isMobile ? "0" : i === 0 ? "0 16px 0 0" : "0 16px",
                borderLeft: !isMobile && i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
                borderTop: isMobile && i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
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
  );
}
