import { useLayoutEffect, useRef, useState } from "react";
import { dayBucketLabel } from "../../../lib/redesign-helpers";
import Tooltip from "../../shared/Tooltip";
import TimelineNowMarker from "./TimelineNowMarker";
import TimelineRow from "./TimelineRow";
import {
  formatFullDateForOffset,
  GUTTER,
  MOBILE_GUTTER,
  MOBILE_SPINE_LEFT,
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
  const [markerTop, setMarkerTop] = useState(null);

  const gutter = isMobile ? MOBILE_GUTTER : GUTTER;
  const spineLeft = isMobile ? MOBILE_SPINE_LEFT : SPINE_LEFT;

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

    let liveIndex = -1;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.kind !== "event") continue;
      if (item.startMs != null && item.endMs != null && item.startMs <= now && now < item.endMs) {
        liveIndex = index;
        break;
      }
    }

    if (liveIndex >= 0 && rowRefs.current[liveIndex]) {
      const row = rowRefs.current[liveIndex];
      const item = items[liveIndex];
      const progress = (now - item.startMs) / (item.endMs - item.startMs);
      setMarkerTop(row.offsetTop + progress * row.offsetHeight);
      return;
    }

    let firstFutureIndex = -1;
    for (let index = 0; index < items.length; index += 1) {
      const ms = items[index].startMs ?? items[index].dueAtMs;
      if (ms != null && ms > now) {
        firstFutureIndex = index;
        break;
      }
    }

    if (firstFutureIndex === 0) {
      setMarkerTop(0);
      return;
    }
    if (firstFutureIndex > 0 && rowRefs.current[firstFutureIndex - 1]) {
      const previousRow = rowRefs.current[firstFutureIndex - 1];
      setMarkerTop(previousRow.offsetTop + previousRow.offsetHeight + 2);
      return;
    }

    const lastIndex = items.length - 1;
    if (rowRefs.current[lastIndex]) {
      const lastRow = rowRefs.current[lastIndex];
      setMarkerTop(lastRow.offsetTop + lastRow.offsetHeight + 2);
      return;
    }

    setMarkerTop(null);
  }, [isToday, items, now]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
