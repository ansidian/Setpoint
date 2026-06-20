import { Fragment } from "react";
import { dayBucketLabel } from "../../../lib/shell-helpers";
import Tooltip from "../../shared/Tooltip";
import TimelineRow from "./TimelineRow";
import TimelineNowMarker from "./TimelineNowMarker";
import {
  formatFullDateForOffset,
  GUTTER,
  MOBILE_GUTTER,
  MOBILE_SPINE_LEFT,
  resolveTodayNowMarkerIndex,
  SPINE_LEFT,
} from "./timeline-helpers";

export default function TimelineDayGroup({
  accent,
  day,
  isFirst,
  isMobile = false,
  items,
  now,
  onJump,
}) {
  const label = dayBucketLabel(day, now);
  const hideHeader = isFirst && day === 0;
  const isToday = day === 0;
  const showRelativeTooltip = day === 1 || day <= -2 || (day >= 2 && day <= 6);

  const gutter = isMobile ? MOBILE_GUTTER : GUTTER;
  const spineLeft = isMobile ? MOBILE_SPINE_LEFT : SPINE_LEFT;
  // The focus-window NOW marker lives only on the desktop today rail; when an
  // event is live, resolveTodayNowMarkerIndex returns null and the in-card
  // progress line in TimelineRow owns the marker instead.
  const nowMarkerIndex = !isMobile && isToday ? resolveTodayNowMarkerIndex(items, now) : null;

  return (
    <div style={{ marginBottom: 24 }}>
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
                  color: isToday ? "#cdd6f4" : "var(--color-text-faint)",
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
                color: isToday ? "#cdd6f4" : "var(--color-text-faint)",
              }}
            >
              {label}
            </div>
          )}
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
          <div style={{ fontSize: 10, color: "var(--color-text-faint)" }}>
            {items.length} {items.length === 1 ? "item" : "items"}
          </div>
        </div>
      )}

      <div
        style={{
          position: "relative",
          paddingLeft: gutter,
          minHeight: isToday && items.length === 0 ? 28 : undefined,
          paddingTop: 4,
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
        {items.map((item, index) => (
          <Fragment key={`${item.kind}-${index}`}>
            {nowMarkerIndex === index && <TimelineNowMarker now={now} accent={accent} />}
            <TimelineRow
              item={item}
              now={now}
              accent={accent}
              onJump={onJump}
              isMobile={isMobile}
            />
          </Fragment>
        ))}
        {nowMarkerIndex === items.length && <TimelineNowMarker now={now} accent={accent} />}
      </div>
    </div>
  );
}
