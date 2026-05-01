import { Repeat } from "lucide-react";
import { parseYmd } from "../calendarDateUtils.js";
import { spanSegmentDisplay } from "./calendarEventSpanLayout.js";

const GRID_ROWS = 6;

function spanLaneMetrics(layout) {
  return {
    rowTop: layout?.tier === "uhd" || layout?.tier === "xl" ? 32 : 30,
    height: 36,
    gap: 4,
  };
}

function clickedSegmentDate(segment, event) {
  if (!event?.currentTarget || !Number.isFinite(event.clientX)) return segment.segmentStart;
  const rect = event.currentTarget.getBoundingClientRect();
  const dayCount = Math.max(1, segment.columnEnd - segment.columnStart);
  const offset = Math.min(
    dayCount - 1,
    Math.max(0, Math.floor(((event.clientX - rect.left) / Math.max(1, rect.width)) * dayCount)),
  );
  let date = segment.segmentStart;
  for (let index = 0; index < offset; index += 1) {
    const parsed = parseYmd(date);
    if (!parsed) return segment.segmentStart;
    const next = new Date(Date.UTC(parsed.year, parsed.month, parsed.day, 12));
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  return date;
}

function spanSegmentStyle(segment, layout, selected, active) {
  const { rowTop, height, gap } = spanLaneMetrics(layout);
  const { color } = spanSegmentDisplay(segment);
  const ghost = segment.kind === "ghost";
  const radius = height >= 30 ? 9 : 8;
  return {
    gridRow: segment.row,
    gridColumn: `${segment.columnStart} / ${segment.columnEnd}`,
    alignSelf: "start",
    margin: `${rowTop + segment.lane * (height + gap)}px 7px 0`,
    height,
    minWidth: 0,
    borderRadius: radius,
    border: ghost
      ? `1px dotted color-mix(in srgb, ${color} 54%, transparent)`
      : selected
        ? `1px solid color-mix(in srgb, ${color} 52%, rgba(255,255,255,0.1))`
        : active
          ? "1px solid rgba(255,255,255,0.13)"
          : "1px solid rgba(255,255,255,0.06)",
    background: selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${color} 19%, transparent), color-mix(in srgb, ${color} 9%, transparent))`
      : active
        ? "rgba(255,255,255,0.07)"
        : "rgba(255,255,255,0.035)",
    color: selected ? "#f6f7fb" : "rgba(205,214,244,0.84)",
    boxShadow: selected
      ? `inset 0 1px 0 color-mix(in srgb, ${color} 18%, rgba(255,255,255,0.02))`
      : "none",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 1,
    boxSizing: "border-box",
    padding: "4px 10px",
    pointerEvents: ghost ? "none" : "auto",
    opacity: ghost ? 0.96 : 1,
    zIndex: 7 + segment.lane,
    overflow: "hidden",
    fontFamily: "inherit",
    textAlign: "left",
    cursor: ghost ? "default" : "pointer",
    transition: "background 140ms, border-color 140ms, box-shadow 140ms, color 140ms",
  };
}

export default function CalendarEventSpanOverlay({
  segments,
  layout,
  gridRowCount,
  fillGridHeight,
  selectedItemId,
  activeSegmentId,
  onSetActive,
  onClearActive,
  onSelectSegment,
  quickActions,
  onBeforeAction,
}) {
  if (!segments?.length) return null;

  return (
    <div
      data-testid="calendar-event-span-overlay"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gridTemplateRows: fillGridHeight
          ? `repeat(${gridRowCount}, minmax(0, 1fr))`
          : `repeat(${GRID_ROWS}, ${layout.cellHeight}px)`,
        gap: layout.gridGap,
        pointerEvents: "none",
        zIndex: 7,
      }}
    >
      {segments.map((segment) => {
        const display = spanSegmentDisplay(segment);
        const selected = segment.eventId && String(segment.eventId) === String(selectedItemId);
        const active = activeSegmentId === segment.id;
        const commonProps = {
          key: segment.id,
          "data-testid": segment.kind === "ghost" ? "calendar-ghost-chip" : "calendar-event-span-segment",
          "data-calendar-focus-ring": segment.kind === "event" ? "true" : undefined,
          "data-item-id": segment.eventId || undefined,
          "data-span-segment-id": segment.id,
          style: spanSegmentStyle(segment, layout, selected, active),
        };
        const content = (
          <>
            <span
              style={{
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 4,
                overflow: "hidden",
                fontSize: 10,
                lineHeight: 1.05,
                fontWeight: 800,
                letterSpacing: 0.15,
                color: selected ? display.color : display.color || "var(--ea-accent)",
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {display.leadingLabel}
              </span>
              {display.recurring ? (
                <Repeat
                  aria-hidden="true"
                  size={10}
                  strokeWidth={2.4}
                  style={{
                    flexShrink: 0,
                    color: selected ? display.color : display.color || "var(--ea-accent)",
                    opacity: selected ? 0.86 : 0.7,
                  }}
                />
              ) : null}
            </span>
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 11.75,
                fontWeight: selected ? 650 : 600,
                lineHeight: 1.1,
              }}
            >
              {display.title}
            </span>
          </>
        );

        if (segment.kind === "ghost") {
          return (
            <div
              {...commonProps}
              data-ghost-kind={segment.item?.kind}
              data-ghost-start={segment.item?.startDate}
              data-ghost-end={segment.item?.endDate}
              aria-hidden="true"
            >
              {content}
            </div>
          );
        }

        const dragAllowed = !segment.readOnly
          && !!quickActions?.dragEnabled
          && !!segment.item?.writable;

        return (
          <button
            {...commonProps}
            type="button"
            draggable={dragAllowed}
            onClick={(event) => {
              event.stopPropagation();
              onSelectSegment?.(segment, {
                triggerElement: event.currentTarget,
                dateKey: clickedSegmentDate(segment, event),
              });
            }}
            onContextMenu={(event) => {
              if (segment.readOnly || !segment.item?.writable) return;
              event.preventDefault();
              event.stopPropagation();
              onBeforeAction?.();
              quickActions?.openDeleteMenu?.({
                event: segment.item,
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onDragStart={(event) => {
              if (!dragAllowed || !quickActions?.beginDrag?.(segment.item)) {
                event.preventDefault();
                return;
              }
              onBeforeAction?.();
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-ea-calendar-event", JSON.stringify(segment.item));
              event.dataTransfer.setData("text/plain", String(segment.item?.title || ""));
            }}
            onDragEnd={() => quickActions?.endDrag?.()}
            onPointerEnter={() => onSetActive?.(segment.id)}
            onPointerLeave={() => onClearActive?.(segment.id)}
            onFocus={() => onSetActive?.(segment.id)}
            onBlur={() => onClearActive?.(segment.id)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
