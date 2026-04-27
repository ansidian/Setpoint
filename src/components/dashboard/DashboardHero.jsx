import { useEffect, useMemo, useState } from "react";
import { CheckCircle, CalendarPlus } from "lucide-react";
import { greetingFor } from "../../lib/redesign-helpers";
import { deriveFocusWindows } from "../../lib/focus-windows";
import { deriveOpenDaySummary } from "../../lib/open-day-summary";
import HeroCalloutCard from "./hero/HeroCalloutCard";
import HeroContextRail from "./hero/HeroContextRail";
import {
  buildHeroCallouts,
  buildHeroStateOfDay,
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
    () => liveCalendar || briefing?.calendar || [],
    [liveCalendar, briefing?.calendar],
  );
  const deadlines = useMemo(() => {
    const ctm = briefing?.ctm?.upcoming || [];
    const todoist = briefing?.todoist?.upcoming || [];
    return [...ctm, ...todoist];
  }, [briefing?.ctm?.upcoming, briefing?.todoist?.upcoming]);
  const bills = useMemo(() => liveBills || [], [liveBills]);

  const stateOfDay = useMemo(() => buildHeroStateOfDay(briefing, now), [briefing, now]);

  const theCallouts = useMemo(
    () => buildHeroCallouts({ events, deadlines, bills, now }),
    [events, deadlines, bills, now],
  );
  const focusWindows = useMemo(
    () => deriveFocusWindows({ events, deadlines, now }),
    [events, deadlines, now],
  );
  const openDaySummary = useMemo(
    () => deriveOpenDaySummary({ deadlines, bills, emails: briefing?.emails, now }),
    [deadlines, bills, briefing?.emails, now],
  );

  const compact = density === "compact";
  const stacked = stack || isMobile;
  const outerPadding = isMobile
    ? "20px 16px 18px"
    : compact ? "22px 22px 18px" : "26px 24px 20px";
  const WeatherIcon = (weather?.icon && WEATHER_ICONS[weather.icon]) || WEATHER_ICONS.Sun;

  return (
    <div
      data-testid={isMobile ? "dashboard-hero-mobile" : "dashboard-hero"}
      style={{
        padding: outerPadding,
        position: "relative",
        overflow: "hidden",
        margin: isMobile ? "0" : "16px 0 0",
        borderRadius: isMobile ? 0 : 24,
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
          gap: stacked ? (isMobile ? 14 : 20) : 32,
          alignItems: "start",
          position: "relative",
        }}
      >
        <HeroMessageBlock
          accent={accent}
          briefing={briefing}
          compact={compact}
          greet={greet}
          isMobile={isMobile}
          now={now}
          stateOfDay={stateOfDay}
        />

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

      <div
        style={{
          display: "flex",
          gap: isMobile ? 8 : 10,
          marginTop: isMobile ? 16 : 24,
          flexWrap: "wrap",
          position: "relative",
          zIndex: 10,
        }}
      >
        {[
          { label: "New Task", icon: CheckCircle, action: "task" },
          { label: "Add Event", icon: CalendarPlus, action: "event" },
        ].map((item, i) => (
          <button
            key={i}
            onClick={() => onQuickAction?.(item.action)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: isMobile ? "8px 14px" : "8px 16px",
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

      {theCallouts.length > 0 && (
        <div
          data-testid="dashboard-hero-callouts"
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : `repeat(${theCallouts.length}, 1fr)`,
            gap: 0,
            marginTop: isMobile ? 14 : compact ? 16 : 18,
            position: "relative",
            paddingTop: isMobile ? 2 : 14,
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
