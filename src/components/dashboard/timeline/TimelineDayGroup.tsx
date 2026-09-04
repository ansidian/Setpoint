import { Fragment, useMemo } from "react";
import { dayBucketLabel } from "../../../lib/shell-helpers";
import Tooltip from "../../shared/Tooltip";
import TimelineRow from "./TimelineRow";
import TimelineNowMarker from "./TimelineNowMarker";
import {
  deriveTimelineRowState,
  formatFullDateForOffset,
  GUTTER,
  MOBILE_GUTTER,
  MOBILE_SPINE_LEFT,
  resolveTodayNowMarkerIndex,
  SPINE_LEFT,
} from "./timeline-helpers";
import type { DashboardTimelineItem } from "./timeline-helpers";
import type { TimelineRowItem, TimelineRowJumpPayload } from "./TimelineRow";

export default function TimelineDayGroup({
  accent,
  day,
  hideDayHeader = false,
  isFirst,
  isMobile = false,
  items,
  now,
  onJump,
  promotedDeadlineIds = [],
  showEmptyState = true,
  emptyDescription = "No events or deadlines scheduled.",
}: {
  accent: string;
  day: number;
  hideDayHeader?: boolean;
  isFirst?: boolean;
  isMobile?: boolean;
  items: DashboardTimelineItem[];
  now: number;
  onJump?: (payload: TimelineRowJumpPayload, anchor: HTMLElement) => void;
  promotedDeadlineIds?: readonly string[];
  showEmptyState?: boolean;
  emptyDescription?: string;
}) {
  const label = dayBucketLabel(day, now);
  const hideHeader = hideDayHeader || (isFirst && day === 0);
  const isToday = day === 0;
  const showRelativeTooltip = day === 1 || day <= -2 || (day >= 2 && day <= 6);

  const gutter = isMobile ? MOBILE_GUTTER : GUTTER;
  const spineLeft = isMobile ? MOBILE_SPINE_LEFT : SPINE_LEFT;
  // The focus-window NOW marker lives only on the desktop today rail; when an
  // event is live, resolveTodayNowMarkerIndex returns null and the in-card
  // progress line in TimelineRow owns the marker instead.
  const nowMarkerIndex = !isMobile && isToday ? resolveTodayNowMarkerIndex(items, now) : null;

  // Memoized on [items, now, isMobile] so an unrelated parent re-render (items
  // and now both unchanged) reuses the same derived-state objects, keeping
  // each row's props referentially stable and letting TimelineRow's own memo
  // bail — only a real tick (or a day/mobile change) recomputes this.
  const rowStates = useMemo(
    () => items.map((item) => deriveTimelineRowState(item, now, { isMobile })),
    [items, now, isMobile],
  );

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
            <Tooltip text={formatFullDateForOffset(day, now)} side="right" sideOffset={8}>
              <div
                style={{
                  fontSize: isMobile ? 10 : 10.5,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: isToday ? "var(--sp-text)" : "var(--color-text-faint)",
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
                color: isToday ? "var(--sp-text)" : "var(--color-text-faint)",
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
          data-timeline-spine-offset={spineLeft}
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
              item={item as TimelineRowItem}
              accent={accent}
              onJump={onJump}
              isMobile={isMobile}
              isPast={rowStates[index]!.isPast}
              isLive={rowStates[index]!.isLive}
              overdueText={rowStates[index]!.overdueText}
              reminderSummary={rowStates[index]!.reminderSummary}
              liveMarker={rowStates[index]!.liveMarker}
              isNeedsYouReference={item.kind === "deadline" && promotedDeadlineIds.includes(String(item.data?.id))}
            />
          </Fragment>
        ))}
        {isToday && items.length === 0 && showEmptyState ? (
          <div
            data-testid="timeline-today-empty"
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              gap: 3,
              minHeight: 44,
              justifyContent: "center",
              padding: "3px 0 7px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: spineLeft - gutter - 3,
                top: 18,
                width: 7,
                height: 7,
                borderRadius: "50%",
                border: `1px solid ${accent}99`,
                background: "var(--sp-page)",
                boxShadow: `0 0 6px ${accent}30`,
              }}
            />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(205,214,244,0.78)" }}>
              Today is clear
            </span>
            <span style={{ fontSize: 10.5, color: "var(--color-text-faint)" }}>
              {emptyDescription}
            </span>
          </div>
        ) : null}
        {nowMarkerIndex === items.length && <TimelineNowMarker now={now} accent={accent} />}
      </div>
    </div>
  );
}
