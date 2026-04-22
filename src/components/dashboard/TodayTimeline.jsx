import { useEffect, useMemo, useState } from "react";
import { motion as Motion } from "motion/react";
import { buildTimeline } from "../../lib/redesign-helpers";
import TimelineDayGroup from "./timeline/TimelineDayGroup";
import TimelineHeader from "./timeline/TimelineHeader";
import {
  buildTimelineGroups,
  formatFullDateForOffset,
  timelineSettleTransition,
} from "./timeline/timeline-helpers";
import TimelineSkeleton from "./timeline/TimelineSkeleton";

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

  const groups = useMemo(
    () => buildTimelineGroups(filtered, now, filters),
    [filtered, now, filters],
  );

  const todayLabel = formatFullDateForOffset(0, now);
  const showEventSkeletons = eventLoadingState === "empty_loading";
  const showRefreshStatus = eventLoadingState === "refreshing";

  return (
    <div
      data-sect="timeline"
      data-testid={isMobile ? "today-timeline-mobile" : "today-timeline"}
      style={{ padding: isMobile ? "18px 16px 20px" : density === "compact" ? "22px 24px 24px" : "26px 28px 28px" }}
    >
      <TimelineHeader
        accent={accent}
        filters={filters}
        isMobile={isMobile}
        onToggleFilter={(key) => setFilters((prev) => ({ ...prev, [key]: !prev[key] }))}
        showRefreshStatus={showRefreshStatus}
        todayLabel={todayLabel}
      />

      <Motion.div
        layout
        transition={timelineSettleTransition}
        style={{ marginTop: 14 }}
      >
        {showEventSkeletons && <TimelineSkeleton isMobile={isMobile} />}
        {groups.map(([day, dayItems], gi) => (
          <TimelineDayGroup
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
