import { useEffect, useMemo, useState } from "react";
import { Sparkles, Sun, Cloud, CloudSun, CloudRain, Snowflake, CloudFog, Moon, Calendar, Video, Plane, AlertCircle, CreditCard, Mail } from "lucide-react";
import { greetingFor, pacificClock, pacificDate, urgencyForDays, daysLabel, formatDuration } from "../../lib/redesign-helpers";
import { daysUntil } from "../../lib/bill-utils";
import { resolveInsight } from "../../lib/insight-resolver";
import { deriveFocusWindows } from "../../lib/focus-windows";
import { deriveOpenDaySummary } from "../../lib/open-day-summary";
import { Skeleton } from "@/components/ui/skeleton";

const WEATHER_ICONS = {
  Sun, Cloud, CloudSun, CloudRain, Snowflake, CloudFog, Moon,
};

function callouts({ events, deadlines, bills, now }) {
  const out = [];
  const nextEvent = (events || []).find((e) => e.startMs && e.startMs > now && e.startMs - now < 4 * 3600000);
  if (nextEvent) {
    const mins = Math.round((nextEvent.startMs - now) / 60000);
    out.push({
      kind: "event",
      icon: nextEvent.hangoutLink || /zoom/i.test(nextEvent.location || "") ? Video
           : /flight|airport/i.test(nextEvent.title || "") ? Plane
           : Calendar,
      lead: `In ${formatDuration(mins)}`,
      title: nextEvent.title,
      sub: (nextEvent.attendees && nextEvent.attendees.length)
        ? `with ${nextEvent.attendees.slice(0, 2).join(", ")}${nextEvent.attendees.length > 2 ? ` +${nextEvent.attendees.length - 2}` : ""}`
        : nextEvent.location,
      urgency: mins < 10 ? "high" : mins < 45 ? "medium" : "low",
    });
  }
  const sortedDeadlines = [...(deadlines || [])]
    .map((d) => ({ d, days: daysUntil(d.due_date) }))
    .filter((x) => x.days != null && x.days <= 7 && x.d.status !== "complete")
    .sort((a, b) => a.days - b.days);
  if (sortedDeadlines[0]) {
    const { d, days } = sortedDeadlines[0];
    out.push({
      kind: "deadline",
      icon: AlertCircle,
      lead: daysLabel(days),
      title: d.title,
      sub: d.class_name || d.source,
      urgency: urgencyForDays(days).key,
    });
  }
  const sortedBills = [...(bills || [])]
    .map((b) => ({ b, days: daysUntil(b.next_date) }))
    .filter((x) => x.days != null && x.days <= 5 && !x.b.paid)
    .sort((a, b) => a.days - b.days);
  if (sortedBills[0] && out.length < 3) {
    const { b, days } = sortedBills[0];
    out.push({
      kind: "bill",
      icon: CreditCard,
      lead: daysLabel(days),
      title: b.name,
      sub: `$${Number(b.amount || 0).toFixed(2)} · ${b.payee || ""}`,
      urgency: urgencyForDays(days).key,
      date: b.next_date,
    });
  }
  return out.slice(0, 3);
}

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

  const stateOfDay = useMemo(() => {
    const insights = briefing?.aiInsights || [];
    const top = insights[0];
    const headline = top ? resolveInsight(top, new Date(now)) : "";
    const summary = briefing?.emails?.summary || "";
    return { headline, summary };
  }, [briefing, now]);

  const theCallouts = useMemo(
    () => callouts({ events, deadlines, bills, now }),
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
    : compact ? "24px 28px 20px" : "40px 36px 32px";
  const WeatherIcon = (weather?.icon && WEATHER_ICONS[weather.icon]) || Sun;

  return (
    <div
      data-testid={isMobile ? "dashboard-hero-mobile" : "dashboard-hero"}
      style={{
        padding: outerPadding,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient accent glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -152,
          right: 0,
          width: 250,
          height: 250,
          background: `radial-gradient(circle, ${accent}16 0%, ${accent}10 32%, transparent 74%)`,
          filter: "blur(10px)",
          opacity: 0.95,
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, black 20%, black 72%, transparent 100%)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, black 20%, black 72%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: stacked ? "1fr" : "minmax(0, 1fr) 240px",
          gap: stacked ? (isMobile ? 14 : 18) : 40,
          alignItems: "start",
          position: "relative",
        }}
      >
        {/* Greeting + state-of-day */}
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: isMobile ? 2 : 2.6,
              textTransform: "uppercase",
              color: "rgba(205,214,244,0.55)",
              marginBottom: isMobile ? 8 : 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: 99,
                background: accent,
                boxShadow: `0 0 6px ${accent}`,
                display: "inline-block",
              }}
            />
            {pacificDate(new Date(now))} · {pacificClock(new Date(now))}
          </div>

          <h1
            className="ea-display"
            style={{
              margin: isMobile ? "0 0 10px" : "0 0 14px",
              fontSize: isMobile ? 24 : compact ? 28 : 40,
              fontWeight: 300,
              letterSpacing: isMobile ? -0.4 : -0.6,
              lineHeight: isMobile ? 1.08 : 1.1,
              color: "#cdd6f4",
              textWrap: "balance",
            }}
          >
            <span style={{ display: "block" }}>{greet.text}.</span>
            {!isMobile && stateOfDay.headline && (
              <span
                style={{
                  color: "rgba(205,214,244,0.5)",
                  fontStyle: "italic",
                  fontWeight: 300,
                  display: "block",
                  marginTop: isMobile ? 4 : 2,
                }}
              >
                {stateOfDay.headline}
              </span>
            )}
          </h1>

          {stateOfDay.summary && (
            <p
              style={{
                margin: "0 0 6px",
                maxWidth: isMobile ? "100%" : 680,
                fontSize: isMobile ? 13 : compact ? 14 : 15,
                lineHeight: isMobile ? 1.55 : 1.65,
                color: "rgba(205,214,244,0.72)",
                textWrap: "pretty",
              }}
            >
              {stateOfDay.summary}
            </p>
          )}

          {/* AI signature chip */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: isMobile ? 4 : 6,
              padding: isMobile ? "2px 8px" : "3px 9px",
              borderRadius: 99,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.05)",
              fontSize: isMobile ? 9 : 10,
              letterSpacing: 0.3,
              color: "rgba(205,214,244,0.4)",
            }}
          >
            <Sparkles size={9} color={accent} />
            {briefing?.model || "Claude"} ·{" "}
            {(briefing?.aiInsights || []).length} insights
          </div>
        </div>

        {/* Right column: weather + focus band */}
        <div
          style={{
            display: "flex",
            flexDirection: stacked && !isMobile ? "row" : "column",
            gap: isMobile ? 8 : 10,
            minWidth: 0,
          }}
        >
          <div
            style={{
              flex: stacked && !isMobile ? 1 : "unset",
              padding: isMobile ? "12px 14px" : "14px 16px",
              borderRadius: 12,
              background:
                "linear-gradient(155deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: isMobile ? 38 : 42,
                height: isMobile ? 38 : 42,
                borderRadius: 10,
                background: "rgba(255,255,255,0.03)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <WeatherIcon size={20} color="#cdd6f4" />
            </div>
            <div>
              <div
              style={{
                fontSize: isMobile ? 16 : 18,
                fontWeight: 500,
                color: "#cdd6f4",
                lineHeight: 1,
                }}
              >
                {weather?.temp != null ? `${Math.round(weather.temp)}°` : "—"}
              </div>
              <div
              style={{
                  fontSize: isMobile ? 10 : 10.5,
                  color: "rgba(205,214,244,0.5)",
                  marginTop: 3,
                  letterSpacing: 0.2,
                }}
              >
                {weather?.condition || ""}
                {weather?.city ? ` · ${weather.city}` : ""}
              </div>
            </div>
          </div>

          <FocusCard
            focusWindows={focusWindows}
            openDaySummary={openDaySummary}
            accent={accent}
            isMobile={isMobile}
            onOpenPressure={onOpenPressure}
            eventLoadingState={eventLoadingState}
          />
        </div>
      </div>

      {theCallouts.length > 0 && (
        <div
          data-testid="dashboard-hero-callouts"
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : `repeat(${theCallouts.length}, 1fr)`,
            gap: isMobile ? 8 : 10,
            marginTop: isMobile ? 16 : compact ? 22 : 28,
            position: "relative",
          }}
        >
          {theCallouts.map((c, i) => (
            <Callout
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

function FocusRefreshStatus({ accent }) {
  return (
    <div
      data-testid="focus-window-refresh-status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        marginBottom: 8,
        padding: "3px 8px",
        borderRadius: 9999,
        border: `1px solid ${accent}38`,
        background: `${accent}14`,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: 0.25,
        color: "#cdd6f4",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: accent,
          boxShadow: `0 0 6px ${accent}70`,
          animation: "dashPulse 1.8s ease-in-out infinite",
        }}
      />
      Updating Google Calendar
    </div>
  );
}

function FocusCard({
  focusWindows,
  openDaySummary,
  accent,
  isMobile = false,
  onOpenPressure,
  eventLoadingState = "ready",
}) {
  const [pressureHover, setPressureHover] = useState(false);
  const [pressureFocus, setPressureFocus] = useState(false);
  const pressureLabel = focusWindows.pressure.level === "high"
    ? `${focusWindows.pressure.overdue + focusWindows.pressure.today} urgent deadline${focusWindows.pressure.overdue + focusWindows.pressure.today === 1 ? "" : "s"}`
    : focusWindows.pressure.level === "medium"
      ? `${focusWindows.pressure.soon} deadline${focusWindows.pressure.soon === 1 ? "" : "s"} soon`
      : "Low pressure";
  const primary = focusWindows.primaryWindow;
  const backup = focusWindows.backupWindow;
  const fallback = focusWindows.fallback;
  const isOpenDay = primary?.quality === "Rest of day open";
  const pressureActive = pressureHover || pressureFocus;
  const showSkeletons = eventLoadingState === "empty_loading";
  const showRefreshStatus = eventLoadingState === "refreshing";

  return (
    <div
      data-testid="focus-window-card"
      style={{
        flex: "unset",
        padding: isMobile ? "12px 14px" : "12px 14px 14px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: isMobile ? 9 : 9.5,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "rgba(205,214,244,0.4)",
          }}
        >
          Focus blocks
        </div>
        {focusWindows.pressure.level === "low" ? (
          <div
            style={{
              fontSize: 10,
              color: "rgba(205,214,244,0.42)",
            }}
          >
            {pressureLabel}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenPressure?.()}
            onMouseEnter={() => setPressureHover(true)}
            onMouseLeave={() => setPressureHover(false)}
            onFocus={() => setPressureFocus(true)}
            onBlur={() => setPressureFocus(false)}
            style={{
              fontSize: 10,
              color: "#f9e2af",
              fontWeight: 600,
              fontFamily: "inherit",
              background: pressureActive ? "rgba(249,226,175,0.12)" : "rgba(249,226,175,0.08)",
              border: `1px solid ${pressureActive ? "rgba(249,226,175,0.3)" : "rgba(249,226,175,0.18)"}`,
              borderRadius: 9999,
              padding: "3px 8px",
              cursor: "pointer",
              transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
            }}
          >
            {pressureLabel}
          </button>
        )}
      </div>

      {showRefreshStatus && <FocusRefreshStatus accent={accent} />}

      {showSkeletons ? (
        <div data-testid="focus-window-skeleton" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton className="h-[18px] w-[62%] bg-white/10" />
          <Skeleton className="h-[12px] w-[90%] bg-white/8" />
          <Skeleton className="h-[12px] w-[72%] bg-white/8" />
        </div>
      ) : primary && isOpenDay ? (
        <OpenDayBlock
          summary={openDaySummary}
          accent={accent}
          isMobile={isMobile}
        />
      ) : primary ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: `${accent}0d`,
              border: `1px solid ${accent}22`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 10, color: "rgba(205,214,244,0.45)", textTransform: "uppercase", letterSpacing: 0.7 }}>
                Best block
              </div>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: accent,
                  background: `${accent}18`,
                  border: `1px solid ${accent}30`,
                  borderRadius: 9999,
                  padding: "2px 7px",
                }}
              >
                {primary.quality}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <div style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600, color: "#cdd6f4", letterSpacing: -0.2 }}>
                {primary.timeRangeLabel}
              </div>
              <div style={{ fontSize: 10.5, color: "rgba(205,214,244,0.52)" }}>
                {primary.durationLabel}
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: isMobile ? 10.5 : 11, color: "rgba(205,214,244,0.68)", lineHeight: 1.45 }}>
              {primary.explanation}
            </div>
          </div>

          {backup && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                paddingTop: 8,
                borderTop: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div>
                <div style={{ fontSize: 10, color: "rgba(205,214,244,0.42)", textTransform: "uppercase", letterSpacing: 0.7 }}>
                  Backup
                </div>
                <div style={{ marginTop: 4, fontSize: 11.5, color: "#cdd6f4" }}>
                  {backup.timeRangeLabel}
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: "rgba(205,214,244,0.5)", whiteSpace: "nowrap" }}>
                {backup.durationLabel}
              </div>
            </div>
          )}
        </div>
      ) : fallback?.kind === "short-window" ? (
        <div style={{ fontSize: isMobile ? 11 : 11.5, color: "#cdd6f4", lineHeight: 1.45 }}>
          <div style={{ fontWeight: 500 }}>No protected block left today.</div>
          <div style={{ marginTop: 4, color: "rgba(205,214,244,0.62)" }}>
            Next short opening: {fallback.timeRangeLabel} · {fallback.durationLabel}.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: isMobile ? 11 : 11.5, color: "#cdd6f4", lineHeight: 1.45 }}>
          {focusWindows.fallback?.kind === "open-day"
            ? "Rest of day looks open. Pick the block that matters most."
            : "No protected block left today."}
        </div>
      )}
    </div>
  );
}

const OPEN_DAY_ICONS = {
  deadline: AlertCircle,
  bill: CreditCard,
  email: Mail,
};

const OPEN_DAY_URGENCY_COLOR = {
  high: "#f38ba8",
  medium: "#f9e2af",
  low: null,
};

function OpenDayBlock({ summary, accent, isMobile = false }) {
  const isLight = summary.tone === "light";
  const primary = summary.primary;
  const Icon = primary ? OPEN_DAY_ICONS[primary.kind] : null;
  const urgencyColor = primary ? (OPEN_DAY_URGENCY_COLOR[primary.urgency] || accent) : accent;
  const hasPrimaryMeta = Boolean(primary?.sub || primary?.timingLabel);

  return (
    <div
      data-testid="focus-window-open-day"
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: `${accent}0d`,
        border: `1px solid ${accent}22`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, color: "rgba(205,214,244,0.45)", textTransform: "uppercase", letterSpacing: 0.7 }}>
          Open day
        </div>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: accent,
            background: `${accent}18`,
            border: `1px solid ${accent}30`,
            borderRadius: 9999,
            padding: "2px 7px",
          }}
        >
          No more events
        </span>
      </div>

      {isLight ? (
        <div
          data-testid="focus-window-open-day-light"
          style={{ marginTop: 8, fontSize: isMobile ? 11.5 : 12, color: "rgba(205,214,244,0.7)", lineHeight: 1.45 }}
        >
          {summary.hint}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            {Icon ? (
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={11} color={urgencyColor} />
              </div>
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: urgencyColor,
                }}
              >
                {primary.contextLabel}
              </div>
              <div
                style={{
                  fontSize: isMobile ? 13 : 13.5,
                  fontWeight: 500,
                  color: "#cdd6f4",
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {primary.title}
              </div>
            </div>
          </div>
          {hasPrimaryMeta ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 10,
                paddingTop: 8,
                borderTop: "1px solid rgba(255,255,255,0.05)",
                fontSize: 10.5,
                color: "rgba(205,214,244,0.55)",
              }}
            >
              {primary.sub ? (
                <div
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {primary.sub}
                </div>
              ) : null}
              {primary.timingLabel ? (
                <div style={{ color: "rgba(205,214,244,0.4)", whiteSpace: "nowrap" }}>
                  {primary.timingLabel}
                </div>
              ) : null}
            </div>
          ) : null}
          {summary.secondaries.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 4 }}>
              {summary.secondaries.map((item) => (
                <div
                  key={item.kind}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, color: "rgba(205,214,244,0.55)" }}
                >
                  <span>{item.title}</span>
                  <span style={{ color: "rgba(205,214,244,0.4)" }}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Callout({ icon, lead, title, sub, urgency, accent, onJump, kind, isMobile = false }) {
  const Icon = icon;
  const colors = {
    high:   { bar: "#f38ba8", dot: "#f38ba8" },
    medium: { bar: "#f9e2af", dot: "#f9e2af" },
    low:    { bar: accent,    dot: accent },
  };
  const uc = colors[urgency] || colors.low;
  const kindLabel = { event: "Next up", deadline: "Deadline", bill: "Payment" }[kind] || "";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => onJump?.(e.currentTarget)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onJump?.(e.currentTarget); }}
      style={{
        padding: isMobile ? "12px 14px" : "14px 16px", borderRadius: 11,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer", position: "relative", overflow: "hidden",
        transition: "all 150ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.025)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: uc.bar }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div
          style={{
            width: isMobile ? 20 : 22, height: isMobile ? 20 : 22, borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
            display: "grid", placeItems: "center",
          }}
        >
          <Icon size={isMobile ? 10 : 11} color={uc.dot} />
        </div>
        <div
          style={{
            fontSize: isMobile ? 9 : 9.5, letterSpacing: 0.6, textTransform: "uppercase",
            color: "rgba(205,214,244,0.45)",
          }}
        >
          {kindLabel}
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: isMobile ? 10 : 10.5, fontWeight: 600, letterSpacing: 0.2,
            color: uc.dot,
          }}
        >
          {lead}
        </div>
      </div>

      <div
        style={{
          fontSize: isMobile ? 13 : 14, fontWeight: 500, color: "#cdd6f4", lineHeight: 1.35,
          marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          style={{
            fontSize: isMobile ? 11 : 11.5, color: "rgba(205,214,244,0.55)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
