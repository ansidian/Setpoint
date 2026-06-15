import { memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion as Motion } from "motion/react";
import { buildTimeline } from "../../lib/shell-helpers";
import TimelineDayGroup from "./timeline/TimelineDayGroup";
import TimelineHeader from "./timeline/TimelineHeader";
import {
  buildTimelineGroups,
  formatFullDateForOffset,
} from "./timeline/timeline-helpers";
import TimelineSkeleton from "./timeline/TimelineSkeleton";

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
  onJump,
  eventLoadingState = "ready",
  scrollContained = true,
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
  const groups = useMemo(
    () => buildTimelineGroups(filtered, now, filters, { minDay: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, nowDayKey, filters],
  );

  const todayLabel = formatFullDateForOffset(0, now);
  const holdPartialTimeline = eventLoadingState !== "ready" && filters.events;
  const showEventSkeletons = holdPartialTimeline;
  const visibleGroups = holdPartialTimeline ? [] : groups;
  const showRefreshStatus = eventLoadingState === "refreshing";
  const containScroll = !isMobile && scrollContained;

  return (
    <div
      data-sect="timeline"
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
        <AnimatePresence initial={false}>
          {visibleGroups.map(([day, dayItems], gi) => (
            <Motion.div
              key={day}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{
                opacity: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
                y: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
              }}
              style={isMobile ? undefined : {
                contentVisibility: "auto",
                containIntrinsicSize: "180px",
              }}
            >
              <TimelineDayGroup
                day={day}
                items={dayItems}
                now={now}
                accent={accent}
                onJump={onJump}
                isFirst={gi === 0}
                isMobile={isMobile}
              />
            </Motion.div>
          ))}
        </AnimatePresence>
        {visibleGroups.length === 0 && !showEventSkeletons && (
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
      </div>
    </div>
  );
}

export default memo(TodayTimeline);
