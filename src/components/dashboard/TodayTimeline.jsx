import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion as Motion } from "motion/react";
import {
  Video, Plane, Calendar, Coffee, Users,
  Circle, CircleDashed, CheckCircle2, Flag,
} from "lucide-react";
import {
  buildTimeline, dayBucket, dayBucketLabel,
  eventState, formatEventTime, formatEventDuration,
  urgencyForDays, pacificClock, overdueLabel,
} from "../../lib/redesign-helpers";
import { daysUntil } from "../../lib/bill-utils";
import Tooltip from "../shared/Tooltip";
import { Skeleton } from "@/components/ui/skeleton";

// Matches Rails.jsx. Todoist priority: 1=urgent, 2=high, 3=medium, 4=low; we
// only surface 1–3 because "no flag" is the expected baseline.
const PRIORITY_COLOR = {
  1: "#f38ba8",
  2: "#f9e2af",
  3: "#89b4fa",
};

const DEADLINE_SOURCE_COLORS = {
  canvas: "#5A8FBF",
  manual: "#5A8FBF",
  todoist: "#E9776A",
};

const timelineSettleTransition = {
  type: "spring",
  stiffness: 290,
  damping: 32,
  mass: 0.98,
  bounce: 0,
};

function formatFullDateForOffset(offset, now) {
  const date = new Date(now + offset * 86400000);
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function PriorityFlag({ level, size = 11 }) {
  const color = PRIORITY_COLOR[level];
  if (!color) return null;
  return (
    <span
      title={`P${level}`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: size + 4, height: size + 4, borderRadius: 4,
        background: `${color}1e`, border: `1px solid ${color}38`,
        flexShrink: 0,
      }}
    >
      <Flag size={size - 2} color={color} strokeWidth={2.2} />
    </span>
  );
}

function SectionHeader({ title, right }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "flex-end",
        justifyContent: "space-between", gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 10, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase",
          color: "rgba(205,214,244,0.55)",
        }}
      >
        {title}
      </div>
      {right}
    </div>
  );
}

function TimelineRefreshStatus({ accent }) {
  return (
    <div
      data-testid="timeline-refresh-status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "3px 8px",
        borderRadius: 9999,
        border: `1px solid ${accent}38`,
        background: `${accent}14`,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: 0.25,
        color: "#cdd6f4",
        whiteSpace: "nowrap",
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

function TimelineFilterChip({ active, accent, isMobile = false, label, onToggle }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const highlighted = hover || focus;
  const background = active
    ? `${accent}1f`
    : highlighted
      ? "rgba(255,255,255,0.035)"
      : "transparent";
  const borderColor = active
    ? `${accent}38`
    : highlighted
      ? "rgba(255,255,255,0.08)"
      : "transparent";
  const color = active
    ? accent
    : highlighted
      ? "rgba(205,214,244,0.82)"
      : "rgba(205,214,244,0.5)";
  const dotBorder = active
    ? accent
    : highlighted
      ? "rgba(205,214,244,0.55)"
      : "rgba(205,214,244,0.35)";
  const dotBackground = active
    ? accent
    : highlighted
      ? "rgba(205,214,244,0.16)"
      : "transparent";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        padding: isMobile ? "6px 9px" : "4px 10px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: isMobile ? 10 : 10.5,
        fontFamily: "inherit",
        letterSpacing: 0.2,
        background,
        border: `1px solid ${borderColor}`,
        color,
        transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: dotBackground,
          border: `1px solid ${dotBorder}`,
          boxShadow: active ? `0 0 6px ${accent}80` : "none",
          transition: "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
        }}
      />
      {label}
    </button>
  );
}

// Absolute-positioned marker overlaid on the today group. The pill lives in
// the left gutter (to the left of the spine dot) so it never collides with
// event text, and the gradient line fades from the spine rightward across the
// content area. `top` is computed from DOM measurements of row refs so the
// marker slides smoothly within a live event and at row boundaries.
function NowMarker({ accent, now, top, spineLeft, pillGap, isMobile = false }) {
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, top,
        pointerEvents: "none", zIndex: 5,
        transition: "top 1s ease",
      }}
    >
      <div
        style={{
          position: "absolute",
          ...(isMobile
            ? { left: spineLeft + 10 }
            : { right: `calc(100% - ${spineLeft - 6 - pillGap}px)` }),
          top: 0, transform: "translateY(-50%)",
          fontSize: isMobile ? 9 : 9.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
          color: accent, padding: isMobile ? "2px 7px" : "2px 8px",
          background: `${accent}15`, borderRadius: 99, border: `1px solid ${accent}30`,
          whiteSpace: "nowrap",
        }}
      >
        Now · {pacificClock(new Date(now))}
      </div>
      {/* Split: outer owns positioning + translateY centering; inner owns the
         pulse animation. Combining both on one element breaks — dashPulse sets
         `transform: scale(...)`, which replaces (not composes with) inline
         `translateY(-50%)` and drops the dot ~6.5px below the marker line. */}
      <div
        style={{
          position: "absolute", left: spineLeft - 6, top: 0,
          transform: "translateY(-50%)",
          width: 13, height: 13,
        }}
      >
        <div
          style={{
            width: "100%", height: "100%", borderRadius: 99,
            background: accent,
            boxShadow: `0 0 12px ${accent}, 0 0 0 3px ${accent}25`,
            animation: "dashPulse 2s ease-in-out infinite",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute", left: spineLeft + 8, right: 0, top: 0, height: 1,
          background: `linear-gradient(90deg, ${accent}60, transparent)`,
        }}
      />
    </div>
  );
}

function TimelineRow({ item, now, accent, onJump, isMobile = false }) {
  let Icon, iconColor, title, sub, meta, leftLabel, urgency, jumpPayload;
  let isPast = false, isLive = false;
  let priorityLevel = null;
  let overdueText = null;
  let railDotColor = null;

  if (item.kind === "event") {
    const ev = item.data;
    const state = eventState(ev, now);
    isPast = state === "past";
    isLive = state === "live";
    Icon = /zoom|video/i.test(ev.location || "") || ev.hangoutLink ? Video
         : /flight|airport|plane/i.test(ev.title || "") ? Plane
         : /coffee|lunch|dinner/i.test(ev.title || "") ? Coffee
         : ev.attendees?.length > 1 ? Users
         : Calendar;
    leftLabel = formatEventTime(ev.startMs);
    title = ev.title;
    sub = ev.attendees?.length
      ? `with ${ev.attendees.slice(0, 3).join(", ")}${ev.attendees.length > 3 ? ` +${ev.attendees.length - 3}` : ""}`
      : ev.location || ev.subtitle;
    meta = formatEventDuration(ev.startMs, ev.endMs);
    urgency = isLive ? "high" : "low";
    railDotColor = ev.color || ev.sourceColor || accent;
    jumpPayload = { kind: "event", id: ev.id, data: ev };
  } else if (item.kind === "deadline") {
    const d = item.data;
    const days = daysUntil(d.due_date);
    urgency = urgencyForDays(days, accent).key;
    isPast = d.status === "complete";
    Icon = d.status === "complete" ? CheckCircle2
         : d.status === "in_progress" ? CircleDashed
         : Circle;
    iconColor = d.status === "complete" ? "#a6e3a1"
              : d.status === "in_progress" ? "#89dceb"
              : "rgba(205,214,244,0.55)";
    leftLabel = d.due_time || "11:59p";
    title = d.title;
    sub = d.class_name || d.source || "";
    meta = d.source === "todoist" ? "Todoist" : d.source === "canvas" ? "Canvas" : "CTM";
    if (d.source === "todoist" && PRIORITY_COLOR[d.priority]) {
      priorityLevel = d.priority;
    }
    if (d.source === "todoist" && d.status !== "complete") {
      overdueText = overdueLabel(item.dueAtMs, now);
    }
    railDotColor =
      DEADLINE_SOURCE_COLORS[d.source] || DEADLINE_SOURCE_COLORS.canvas;
    jumpPayload = { kind: "deadline", id: d.id, data: d };
  } else {
    return null;
  }

  const urgColors = { high: "#f38ba8", medium: "#f9e2af", low: accent };
  const dotColor = urgColors[urgency] || accent;
  const effectiveRailDotColor = railDotColor || dotColor;
  const opacity = isPast ? 0.38 : 1;
  const railBorderColor = railDotColor
    ? `${effectiveRailDotColor}${isLive ? "" : "55"}`
    : isLive
      ? effectiveRailDotColor
      : "rgba(255,255,255,0.15)";
  const railGlow = isLive
    ? `0 0 10px ${effectiveRailDotColor}80`
    : railDotColor
      ? `0 0 0 1px ${effectiveRailDotColor}18`
      : "none";
  const timeColumnWidth = isMobile ? 52 : 54;

  return (
    <div
      data-testid={isMobile ? "timeline-row-mobile" : "timeline-row-desktop"}
      role="button"
      tabIndex={0}
      onClick={(e) => onJump?.(jumpPayload, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ")
          onJump?.(jumpPayload, e.currentTarget);
      }}
      style={{
        position: "relative",
        padding: isMobile ? "10px 10px 10px 22px" : "9px 12px",
        marginBottom: 4,
        borderRadius: 9,
        cursor: "pointer",
        opacity,
        border: "1px solid transparent",
        transition: "all 130ms",
        display: "grid",
        gridTemplateColumns: isMobile ? `${timeColumnWidth}px minmax(0, 1fr)` : `${timeColumnWidth}px 1fr auto`,
        gap: isMobile ? 10 : 14,
        alignItems: isMobile ? "start" : "center",
        background: isLive ? `${accent}08` : "transparent",
        ...(isLive ? { borderColor: `${accent}30` } : {}),
      }}
      onMouseEnter={(e) => {
        if (!isLive)
          e.currentTarget.style.background = "rgba(255,255,255,0.025)";
      }}
      onMouseLeave={(e) => {
        if (!isLive) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Rail dot */}
      <div
        data-testid="timeline-row-dot"
        style={{
          position: "absolute",
          left: isMobile ? -30 : -22,
          top: isMobile ? 13 : 14,
          width: 13,
          height: 13,
          borderRadius: 99,
          background: "#0b0b13",
          display: "grid",
          placeItems: "center",
          border: `1px solid ${railBorderColor}`,
          boxShadow: railGlow,
        }}
      >
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: 99,
            background: effectiveRailDotColor,
            ...(isLive
              ? { animation: "dashPulse 2s ease-in-out infinite" }
              : {}),
          }}
        />
      </div>

      {/* Time column */}
      <div
        style={{
          fontSize: isMobile ? 10.5 : 11.5,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color: isLive ? dotColor : "rgba(205,214,244,0.7)",
          letterSpacing: 0.2,
          paddingTop: isMobile ? 1 : 0,
        }}
      >
        {leftLabel}
      </div>

      {/* Main */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: isMobile ? "flex-start" : "center",
            flexWrap: isMobile ? "wrap" : "nowrap",
            gap: 8,
            marginBottom: 2,
          }}
        >
          <Icon size={isMobile ? 10 : 11} color={iconColor || "rgba(205,214,244,0.55)"} />
          <div
            style={{
              fontSize: isMobile ? 12.5 : 13,
              fontWeight: 500,
              color: "#cdd6f4",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: isMobile ? "normal" : "nowrap",
              lineHeight: isMobile ? 1.35 : "normal",
              flex: 1,
              minWidth: 0,
              textDecoration: isPast ? "line-through" : "none",
              textDecorationColor: "rgba(205,214,244,0.25)",
            }}
          >
            {title}
          </div>
          {isLive && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 99,
                fontSize: 9,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontWeight: 600,
                background: `${dotColor}20`,
                color: dotColor,
              }}
            >
              Live
            </span>
          )}
          {priorityLevel && <PriorityFlag level={priorityLevel} />}
          {overdueText && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 99,
                fontSize: 9,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontWeight: 600,
                background: "#f38ba820",
                color: "#f38ba8",
                whiteSpace: "nowrap",
              }}
            >
              {overdueText}
            </span>
          )}
        </div>
        {sub && (
          <div
            style={{
              fontSize: isMobile ? 10.5 : 11,
              color: "rgba(205,214,244,0.45)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: isMobile ? "normal" : "nowrap",
              lineHeight: isMobile ? 1.35 : "normal",
            }}
          >
            {sub}
          </div>
        )}
        {isMobile && meta && (
          <div
            style={{
              marginTop: 6,
              display: "inline-flex",
              maxWidth: "100%",
              fontSize: isMobile ? 10 : 10.5,
              color: "rgba(205,214,244,0.5)",
              fontVariantNumeric: "tabular-nums",
              padding: "2px 8px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {meta}
          </div>
        )}
      </div>

      {/* Meta */}
      {!isMobile && meta && (
        <div
          style={{
            fontSize: 10.5,
            color: "rgba(205,214,244,0.5)",
            fontVariantNumeric: "tabular-nums",
            padding: "2px 8px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.03)",
          }}
        >
          {meta}
        </div>
      )}
    </div>
  );
}

/**
 * TodayTimeline — merges events + deadlines onto one chronological rail.
 * The now marker slides proportionally inside a live event's row, otherwise
 * snaps to the boundary between past and future items; CSS transitions the
 * `top` value so the marker animates smoothly between positions.
 */
export default function TodayTimeline({
  accent = "#cba6da",
  density = "comfortable",
  isMobile = false,
  events = [],
  deadlines = [],
  onJump,
  eventLoadingState = "ready",
}) {
  const [filters, setFilters] = useState({ events: true, deadlines: true });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(
    () => buildTimeline({ events, deadlines }),
    [events, deadlines],
  );

  const filtered = items.filter((it) => {
    if (it.kind === "event") return filters.events;
    if (it.kind === "deadline") return filters.deadlines;
    return false;
  });

  const groups = useMemo(() => {
    const g = new Map();
    for (const it of filtered) {
      const ms = it.startMs ?? it.dueAtMs;
      const b = dayBucket(ms, now);
      if (!g.has(b)) g.set(b, []);
      g.get(b).push(it);
    }
    if (filters.events && !filters.deadlines && !g.has(0)) {
      g.set(0, []);
    }
    return [...g.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered, now, filters.events, filters.deadlines]);

  const todayLabel = formatFullDateForOffset(0, now);
  const showEventSkeletons = eventLoadingState === "empty_loading";
  const showRefreshStatus = eventLoadingState === "refreshing";

  return (
    <div
      data-sect="timeline"
      data-testid={isMobile ? "today-timeline-mobile" : "today-timeline"}
      style={{ padding: isMobile ? "18px 16px 20px" : density === "compact" ? "18px 32px" : "24px 36px" }}
    >
      <SectionHeader
        title={
          <Tooltip text={todayLabel} sideOffset={12}>
            <span>Timeline</span>
          </Tooltip>
        }
        right={
          <div
            style={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              alignItems: isMobile ? "flex-start" : "center",
              gap: isMobile ? 6 : 10,
              justifyContent: isMobile ? "flex-start" : "flex-end",
            }}
          >
            {showRefreshStatus && <TimelineRefreshStatus accent={accent} />}
            <div
              role="group"
              aria-label="Timeline filters"
              style={{
                display: "flex",
                flexWrap: isMobile ? "wrap" : "nowrap",
                gap: 2,
                padding: 2,
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
                justifyContent: isMobile ? "flex-start" : "flex-end",
                maxWidth: isMobile ? "100%" : "none",
              }}
            >
              {[
                { id: "events", label: "Events" },
                { id: "deadlines", label: "Deadlines" },
              ].map((f) => {
                const active = !!filters[f.id];
                return (
                  <TimelineFilterChip
                    key={f.id}
                    active={active}
                    accent={accent}
                    isMobile={isMobile}
                    label={f.label}
                    onToggle={() =>
                      setFilters((prev) => ({ ...prev, [f.id]: !prev[f.id] }))
                    }
                  />
                );
              })}
            </div>
          </div>
        }
      />

      <Motion.div
        layout
        transition={timelineSettleTransition}
        style={{ marginTop: 16 }}
      >
        {showEventSkeletons && (
          <div
            data-testid="dashboard-event-skeletons"
            style={{
              marginBottom: 18,
              paddingLeft: isMobile ? 30 : 130,
            }}
          >
            <div
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: isMobile ? 6 : 114,
                  top: 8,
                  bottom: 8,
                  width: 1,
                  background: "rgba(255,255,255,0.06)",
                }}
              />
              {[0, 1].map((index) => (
                <div
                  key={index}
                  style={{
                    position: "relative",
                    display: "grid",
                    gridTemplateColumns: isMobile ? "52px minmax(0, 1fr)" : "54px 1fr auto",
                    gap: isMobile ? 10 : 14,
                    alignItems: "center",
                    padding: isMobile ? "10px 10px 10px 22px" : "9px 12px",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: isMobile ? -30 : -22,
                      top: isMobile ? 13 : 14,
                      width: 13,
                      height: 13,
                      borderRadius: 99,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "#0b0b13",
                    }}
                  />
                  <Skeleton className="h-[12px] w-[42px] bg-white/8" />
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <Skeleton className="h-[12px] w-[58%] bg-white/10" />
                    <Skeleton className="h-[10px] w-[42%] bg-white/7" />
                  </div>
                  {!isMobile && <Skeleton className="h-[18px] w-[56px] bg-white/8" />}
                </div>
              ))}
            </div>
          </div>
        )}
        {groups.map(([day, dayItems], gi) => (
          <DayGroup
            key={day}
            day={day}
            items={dayItems}
            now={now}
            accent={accent}
            onJump={onJump}
            isFirst={gi === 0}
            isMobile={isMobile}
          />
        ))}
        {groups.length === 0 && !showEventSkeletons && (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              fontSize: 12,
              color: "rgba(205,214,244,0.4)",
            }}
          >
            Nothing on the calendar matching this filter.
          </div>
        )}
      </Motion.div>
    </div>
  );
}

// Gutter sizes enough to hold the "Now · HH:MM PM" pill in the left margin
// without colliding with row content. Applied globally so the spine position
// stays visually consistent across day groups; past/future days simply have
// an empty gutter.
const GUTTER = 130;
const SPINE_LEFT = GUTTER - 16; // spine sits 16px before row content
const PILL_SPINE_GAP = 16; // horizontal gap between pill's right edge and the spine dot
const MOBILE_GUTTER = 30;
const MOBILE_SPINE_LEFT = 6;

function DayGroup({ day, items, now, accent, onJump, isFirst, isMobile = false }) {
  const label = dayBucketLabel(day, now);
  const hideHeader = isFirst && day === 0;
  const isToday = day === 0;
  const showRelativeTooltip = day === 1 || day <= -2 || (day >= 2 && day <= 6);

  const rowRefs = useRef([]);
  const [markerTop, setMarkerTop] = useState(null);

  const gutter = isMobile ? MOBILE_GUTTER : GUTTER;
  const spineLeft = isMobile ? MOBILE_SPINE_LEFT : SPINE_LEFT;

  // Position the now-marker by measuring rendered row offsets. Live events
  // get a proportional slide (progress through their duration); elsewhere the
  // marker snaps to a row boundary and relies on CSS `transition: top` to
  // animate between positions. useLayoutEffect is correct here — we read
  // layout then sync state before paint.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!isToday) {
      setMarkerTop(null);
      return;
    }
    if (items.length === 0) {
      setMarkerTop(12);
      return;
    }

    let liveIdx = -1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== "event") continue;
      const s = it.startMs;
      const e = it.endMs;
      if (s != null && e != null && s <= now && now < e) {
        liveIdx = i;
        break;
      }
    }

    if (liveIdx >= 0 && rowRefs.current[liveIdx]) {
      const row = rowRefs.current[liveIdx];
      const it = items[liveIdx];
      const progress = (now - it.startMs) / (it.endMs - it.startMs);
      setMarkerTop(row.offsetTop + progress * row.offsetHeight);
      return;
    }

    let firstFutureIdx = -1;
    for (let i = 0; i < items.length; i++) {
      const ms = items[i].startMs ?? items[i].dueAtMs;
      if (ms != null && ms > now) { firstFutureIdx = i; break; }
    }

    if (firstFutureIdx === 0) {
      setMarkerTop(0);
      return;
    }
    if (firstFutureIdx > 0 && rowRefs.current[firstFutureIdx - 1]) {
      const prev = rowRefs.current[firstFutureIdx - 1];
      setMarkerTop(prev.offsetTop + prev.offsetHeight + 2);
      return;
    }

    const lastIdx = items.length - 1;
    if (rowRefs.current[lastIdx]) {
      const last = rowRefs.current[lastIdx];
      setMarkerTop(last.offsetTop + last.offsetHeight + 2);
      return;
    }

    setMarkerTop(null);
  }, [items, now, isToday]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div style={{ marginBottom: 28 }}>
      {!hideHeader && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
            paddingLeft: 2,
            flexWrap: isMobile ? "wrap" : "nowrap",
          }}
        >
          {showRelativeTooltip ? (
            <Tooltip text={formatFullDateForOffset(day, now)} sideOffset={12}>
              <div
                style={{
                  fontSize: isMobile ? 10 : 10.5,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: isToday ? "#cdd6f4" : "rgba(205,214,244,0.45)",
                }}
              >
                {label}
              </div>
            </Tooltip>
          ) : (
            <div
              style={{
                fontSize: isMobile ? 10 : 10.5,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                fontWeight: 600,
                color: isToday ? "#cdd6f4" : "rgba(205,214,244,0.45)",
              }}
            >
              {label}
            </div>
          )}
          <div
            style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }}
          />
          <div style={{ fontSize: 10, color: "rgba(205,214,244,0.35)" }}>
            {items.length} {items.length === 1 ? "item" : "items"}
          </div>
        </div>
      )}

      <div
        style={{
          position: "relative",
          paddingLeft: gutter,
          minHeight: isToday && items.length === 0 ? 28 : undefined,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: spineLeft,
            top: 8,
            bottom: 8,
            width: 1,
            background: "rgba(255,255,255,0.06)",
          }}
        />
        {items.map((it, i) => (
          <div
            key={`${it.kind}-${i}`}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
          >
            <TimelineRow item={it} now={now} accent={accent} onJump={onJump} isMobile={isMobile} />
          </div>
        ))}
        {!isMobile && isToday && markerTop != null && (
          <NowMarker
            accent={accent}
            now={now}
            top={markerTop}
            spineLeft={spineLeft}
            pillGap={PILL_SPINE_GAP}
          />
        )}
      </div>
    </div>
  );
}
