import { useEffect, useMemo, useState } from "react";
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
        border: isMobile ? "none" : "1px solid rgba(255,255,255,0.05)",
        background: isMobile
          ? "transparent"
          : [
              `radial-gradient(circle at top right, ${accent}14 0%, transparent 32%)`,
              "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.008) 100%)",
              "#10121a",
            ].join(", "),
      }}
    >
      {/* Ambient accent glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -200,
          right: -120,
          width: 520,
          height: 520,
          background: `radial-gradient(circle, ${accent}12 0%, ${accent}08 24%, ${accent}03 52%, transparent 72%)`,
          opacity: 0.7,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: isMobile ? -80 : -40,
          top: isMobile ? 20 : 18,
          width: isMobile ? "120%" : "68%",
          height: isMobile ? 220 : 260,
          background: [
            `radial-gradient(circle at 0% 30%, ${accent}10 0%, transparent 46%)`,
            "linear-gradient(90deg, rgba(255,255,255,0.022) 0%, rgba(255,255,255,0) 72%)",
          ].join(", "),
          opacity: isMobile ? 0.85 : 1,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 24%)",
          pointerEvents: "none",
        }}
      />

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

      {theCallouts.length > 0 && (
        <div
          data-testid="dashboard-hero-callouts"
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : `repeat(${theCallouts.length}, 1fr)`,
            gap: isMobile ? 8 : 18,
            marginTop: isMobile ? 16 : compact ? 16 : 18,
            position: "relative",
            paddingTop: isMobile ? 0 : 12,
            borderTop: isMobile ? "none" : "1px solid rgba(255,255,255,0.05)",
            alignItems: "stretch",
          }}
        >
          {theCallouts.map((c, i) => (
            <HeroCalloutCard
              key={i}
              {...c}
              accent={accent}
              isMobile={isMobile}
              onJump={(anchor) => onJump?.(c, anchor)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
