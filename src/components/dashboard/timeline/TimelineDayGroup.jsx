import { useLayoutEffect, useRef, useState } from "react";
import { dayBucketLabel } from "../../../lib/shell-helpers";
import Tooltip from "../../shared/Tooltip";
import TimelineNowMarker from "./TimelineNowMarker";
import TimelineRow from "./TimelineRow";
import {
  formatFullDateForOffset,
  GUTTER,
  MOBILE_GUTTER,
  MOBILE_SPINE_LEFT,
  resolveTimelineNowMarkerTop,
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

  const rowRefs = useRef([]);
  const markerTopRef = useRef(null);
  const [markerTop, setMarkerTop] = useState(null);

  const gutter = isMobile ? MOBILE_GUTTER : GUTTER;
  const spineLeft = isMobile ? MOBILE_SPINE_LEFT : SPINE_LEFT;

  useLayoutEffect(() => {
    const commitMarkerTop = (nextMarkerTop) => {
      if (Object.is(markerTopRef.current, nextMarkerTop)) return;
      markerTopRef.current = nextMarkerTop;
      setMarkerTop(nextMarkerTop);
    };

    if (!isToday) {
      commitMarkerTop(null);
      return;
    }
    rowRefs.current = rowRefs.current.slice(0, items.length);
    commitMarkerTop(resolveTimelineNowMarkerTop({
      items,
      now,
      rows: rowRefs.current,
    }));
  }, [isToday, items, now]);

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
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
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
          <div
            key={`${item.kind}-${index}`}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
          >
            <TimelineRow item={item} now={now} accent={accent} onJump={onJump} isMobile={isMobile} />
          </div>
        ))}
        {!isMobile && isToday && markerTop != null && (
          <TimelineNowMarker
            accent={accent}
            now={now}
            top={markerTop}
            spineLeft={spineLeft}
          />
        )}
      </div>
    </div>
  );
}
