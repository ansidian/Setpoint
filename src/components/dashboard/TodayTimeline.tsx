import { memo, useEffect, useMemo, useState } from "react";
import { motion as Motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { buildTimeline } from "../../lib/shell-helpers";
import type { TimelineEvent } from "../../lib/shell-helpers";
import TimelineDayGroup from "./timeline/TimelineDayGroup";
import MobileTodayTimeline from "./timeline/MobileTodayTimeline";
import TimelineHeader from "./timeline/TimelineHeader";
import {
  buildTodayTomorrowRestGroups,
  formatFullDateForOffset,
  shouldHoldPartialTimeline,
} from "./timeline/timeline-helpers";
import TimelineSkeleton from "./timeline/TimelineSkeleton";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";
import type { TimelineDeadline } from "../../lib/shell-helpers";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import type { DashboardTimelineItem, TimelineFilters, TimelineGroup } from "./timeline/timeline-helpers";
import type { TimelineRowJumpPayload } from "./timeline/TimelineRow";
import useMotionPresence from "../../hooks/useMotionPresence";
import { heightMotionDuration, heightTransition, motionDuration, motionTransition } from "../../lib/motion";

type TimelineJump = (payload: TimelineRowJumpPayload, anchor: HTMLElement) => void;
interface TodayTimelineProps {
  accent?: string;
  density?: string;
  isMobile?: boolean;
  events?: Array<TimelineEvent | NormalizedCalendarEvent>;
  deadlines?: DashboardDeadline[];
  deadlinesLoading?: boolean;
  onJump?: TimelineJump;
  eventLoadingState?: string;
  domainRefreshing?: boolean;
  scrollContained?: boolean;
  promotedDeadlineIds?: readonly string[];
}

// Module singleton — used only to derive the day-granular memo key for groups.
const PACIFIC_DAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
});

/**
 * TodayTimeline — merges events + deadlines onto one chronological rail.
 * The now marker slides proportionally inside a live event's row, otherwise
 * snaps to the boundary between past and future items; CSS transitions the
 * `top` value so the marker animates smoothly between positions.
 *
 * Wrapped in React.memo so dashboard poll/refresh re-renders that leave the
 * (reference-stable) events/deadlines props untouched do not re-render it.
 */
function TodayTimeline({
  accent = "#cba6da",
  density = "comfortable",
  isMobile = false,
  events = [],
  deadlines = [],
  deadlinesLoading = false,
  onJump,
  eventLoadingState = "ready",
  domainRefreshing = false,
  scrollContained = true,
  promotedDeadlineIds = [],
}: TodayTimelineProps) {
  const [filters, setFilters] = useState<TimelineFilters>({ events: true, deadlines: true });
  const [now, setNow] = useState(() => Date.now());
  const [tomorrowOpen, setTomorrowOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(
    () => buildTimeline({
      events: events as unknown as TimelineEvent[],
      deadlines: deadlines as TimelineDeadline[],
    }),
    [events, deadlines],
  );

  // Memoize so `filtered` keeps a stable identity across the 30s now-tick (its
  // content only depends on items + filters), which in turn lets the groups memo
  // below avoid rebuilding on every tick.
  const filtered = useMemo(
    () => items.filter((it) => {
      if (it.kind === "event") return filters.events;
      if (it.kind === "deadline") return filters.deadlines;
      return false;
    }),
    [items, filters],
  );

  // Day buckets only change at the Pacific day roll-over, so key the groups memo
  // on the Pacific-YMD of `now` rather than raw ms — the 30s tick no longer
  // rebuilds groups (with their per-item dayBucket work) unless the day rolls.
  const nowDayKey = useMemo(() => PACIFIC_DAY_KEY_FORMATTER.format(new Date(now)), [now]);
  // `now` is intentionally keyed via nowDayKey (day-granular): raw ms would rebuild
  // every tick for an identical bucketing result. The now-marker math reads precise
  // `now` elsewhere (TimelineDayGroup), so live marker movement is unaffected.
  const ttr = useMemo(
    () => buildTodayTomorrowRestGroups(filtered, now, filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, nowDayKey, filters],
  );

  const todayLabel = formatFullDateForOffset(0, now);
  const holdPartialTimeline = shouldHoldPartialTimeline({
    eventLoadingState,
    filtersEvents: filters.events,
    filtersDeadlines: filters.deadlines,
    deadlinesLoading,
    hasDeadlineRows: deadlines.length > 0,
  });
  const showEventSkeletons = holdPartialTimeline;
  const showRefreshStatus = eventLoadingState === "refreshing" || domainRefreshing;
  const containScroll = !isMobile && scrollContained;
  const emptyDescription = filters.events && filters.deadlines
    ? "No events or deadlines scheduled."
    : filters.events
      ? "No events scheduled."
      : "No deadlines due.";

  return (
    <div
      data-testid={isMobile ? "today-timeline-mobile" : "today-timeline"}
      style={{
        padding: isMobile ? "18px 16px 20px" : density === "compact" ? "22px 24px 24px" : "26px 28px 28px",
        ...(containScroll ? {
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        } : {}),
      }}
    >
      <TimelineHeader
        accent={accent}
        filters={filters}
        isMobile={isMobile}
        now={now}
        onToggleFilter={(key) => setFilters((prev) => ({ ...prev, [key]: !prev[key] }))}
        showRefreshStatus={showRefreshStatus}
        todayLabel={todayLabel}
      />

      <div
        style={{
          marginTop: 14,
          ...(containScroll ? {
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            paddingRight: 4,
          } : {}),
        }}
      >
        {showEventSkeletons && <TimelineSkeleton isMobile={isMobile} />}

        {!showEventSkeletons && (
          <>
            {isMobile ? (
              <MobileTodayTimeline
                items={ttr.today}
                now={now}
                accent={accent}
                onJump={onJump}
                showEmptyState={filters.events || filters.deadlines}
                emptyDescription={emptyDescription}
                promotedDeadlineIds={promotedDeadlineIds}
              />
            ) : <TimelineDayGroup
              day={0}
              items={ttr.today}
              now={now}
              accent={accent}
              onJump={onJump}
              isFirst
              isMobile={isMobile}
              showEmptyState={filters.events || filters.deadlines}
              emptyDescription={emptyDescription}
              promotedDeadlineIds={promotedDeadlineIds}
            />}
            <div
              style={{
                marginTop: 16,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 2.2,
                textTransform: "uppercase",
                color: "rgba(205,214,244,0.4)",
                padding: "0 6px 4px",
              }}
            >
              Later
            </div>
            <TomorrowGroup
              open={tomorrowOpen}
              onToggle={() => setTomorrowOpen((v) => !v)}
              items={ttr.tomorrow}
              count={ttr.tomorrowCount}
              label={formatFullDateForOffset(1, now)}
              now={now}
              accent={accent}
              onJump={onJump}
              isMobile={isMobile}
            />
            <RestOfWeekGroup
              open={restOpen}
              onToggle={() => setRestOpen((v) => !v)}
              rest={ttr.rest}
              count={ttr.restCount}
              now={now}
              accent={accent}
              onJump={onJump}
              isMobile={isMobile}
            />
          </>
        )}

        {ttr.today.length === 0
            && ttr.tomorrow.length === 0
            && ttr.restCount === 0
            && !filters.events
            && !filters.deadlines
            && !showEventSkeletons && (
            <div
              style={{
                padding: "40px 20px",
                textAlign: "center",
                fontSize: 12,
                color: "var(--color-text-faint)",
              }}
            >
              Nothing on the calendar matching this filter.
            </div>
          )}
      </div>
    </div>
  );
}

function TomorrowGroup({ accent, count, isMobile = false, items, label, now, onJump, onToggle, open }: {
  accent: string;
  count: { events: number; deadlines: number };
  items: DashboardTimelineItem[];
  label: string;
  now: number;
  onJump?: TimelineJump;
  onToggle: () => void;
  open: boolean;
  isMobile?: boolean;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const contentPresence = useMotionPresence(open, reduceMotion ? 0 : heightMotionDuration * 1000);
  const contentRendered = open || contentPresence;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  const summary = [
    count.events ? `${count.events} event${count.events === 1 ? "" : "s"}` : null,
    count.deadlines ? `${count.deadlines} deadline${count.deadlines === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ") || "Nothing scheduled";

  return (
    <div>
      <button type="button" className={isMobile ? "timeline-mobile-control" : undefined} aria-expanded={open} onClick={onToggle}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPressed(false); }}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        style={{ width: "100%", minHeight: isMobile ? 48 : undefined, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: isMobile ? "10px 6px" : "11px 6px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.04)", outline: focus ? "1px solid color-mix(in srgb, var(--sp-accent) 55%, transparent)" : "none", outlineOffset: -1, background: pressed ? "rgba(255,255,255,0.05)" : hover || focus ? "rgba(255,255,255,0.02)" : "transparent", cursor: "pointer", color: "inherit", font: "inherit", transition: "background 130ms ease, outline-color 130ms ease" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <Motion.span
            aria-hidden="true"
            animate={{ rotate: open && !reduceMotion ? 90 : 0 }}
            transition={motionTransition(reduceMotion, motionDuration.feedback)}
            style={{ display: "inline-flex" }}
          >
            <ChevronRight size={14} color="rgba(205,214,244,0.5)" />
          </Motion.span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--sp-text)" }}>Tomorrow</span>
          {!isMobile && <span style={{ fontSize: 11, color: "rgba(205,214,244,0.4)" }}>{label}</span>}
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, color: "rgba(205,214,244,0.5)" }}>{summary}</span>
      </button>
      {contentRendered && (
        <Motion.div
          data-testid="tomorrow-disclosure-content"
          aria-hidden={!open}
          inert={!open ? true : undefined}
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
          transition={heightTransition(reduceMotion)}
          style={{ overflow: "hidden" }}
        >
        <div style={{ padding: "4px 0 6px" }}>
          {items.length > 0 && (
            <TimelineDayGroup
              day={1}
              hideDayHeader
              items={items}
              now={now}
              accent={accent}
              onJump={onJump}
              isMobile={isMobile}
            />
          )}
          {items.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--color-text-faint)", padding: `6px 0 6px ${isMobile ? 28 : 44}px` }}>Nothing scheduled tomorrow.</div>
          )}
        </div>
        </Motion.div>
      )}
    </div>
  );
}

function RestOfWeekGroup({ accent, count, isMobile = false, now, onJump, onToggle, open, rest }: {
  accent: string;
  count: number;
  isMobile?: boolean;
  now: number;
  onJump?: TimelineJump;
  onToggle: () => void;
  open: boolean;
  rest: TimelineGroup[];
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const contentPresence = useMotionPresence(open, reduceMotion ? 0 : heightMotionDuration * 1000);
  const contentRendered = open || contentPresence;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  if (count <= 0) return null;

  return (
    <div>
      <button type="button" className={isMobile ? "timeline-mobile-control" : undefined} aria-expanded={open} onClick={onToggle}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPressed(false); }}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        style={{ width: "100%", minHeight: isMobile ? 48 : undefined, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: isMobile ? "10px 6px" : "11px 6px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.04)", outline: focus ? "1px solid color-mix(in srgb, var(--sp-accent) 55%, transparent)" : "none", outlineOffset: -1, background: pressed ? "rgba(255,255,255,0.05)" : hover || focus ? "rgba(255,255,255,0.02)" : "transparent", cursor: "pointer", color: "inherit", font: "inherit", transition: "background 130ms ease, outline-color 130ms ease" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <Motion.span
            aria-hidden="true"
            animate={{ rotate: open && !reduceMotion ? 90 : 0 }}
            transition={motionTransition(reduceMotion, motionDuration.feedback)}
            style={{ display: "inline-flex" }}
          >
            <ChevronRight size={14} color="rgba(205,214,244,0.5)" />
          </Motion.span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--sp-text)" }}>Rest of this week</span>
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, color: "rgba(205,214,244,0.5)" }}>{count} {count === 1 ? "item" : "items"}</span>
      </button>
      {contentRendered && (
        <Motion.div
          data-testid="rest-of-week-disclosure-content"
          aria-hidden={!open}
          inert={!open ? true : undefined}
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
          transition={heightTransition(reduceMotion)}
          style={{ overflow: "hidden" }}
        >
        <div style={{ paddingTop: 12 }}>
          {rest.map(([day, dayItems]) => (
            <TimelineDayGroup
              key={`rest-${day}`}
              day={day}
              items={dayItems}
              now={now}
              accent={accent}
              onJump={onJump}
              isMobile={isMobile}
            />
          ))}
        </div>
        </Motion.div>
      )}
    </div>
  );
}

export default memo(TodayTimeline);
