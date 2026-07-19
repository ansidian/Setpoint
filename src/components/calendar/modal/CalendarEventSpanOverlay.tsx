import { Repeat } from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import GoogleSpecialDateBadge from "../GoogleSpecialDateBadge.tsx";
import { parseYmd } from "../calendarDateUtils.ts";
import { compactLeadingLabel, getChipLeadingColumnWidth } from "./CalendarCellItemChipModel";
import { spanLaneMetrics, spanSegmentDisplay } from "./calendarEventSpanLayout";
import type {
  CalendarSpanGhost,
  CalendarSpanLayoutMetrics,
  CalendarSpanSegment,
} from "./calendarEventSpanLayout";
import { isEventSelectionModifier } from "../events/calendarEventSelectionModel";
import type { SelectableCalendarEvent } from "../events/calendarEventSelectionModel";
import type { CalendarItemQuickActions } from "./CalendarCellItemChip";

type CalendarSpanRenderSegment = Omit<CalendarSpanSegment, "dateKey" | "startsBeforeSegment" | "endsAfterSegment" | "interactive" | "readOnly" | "eventId"> & {
  dateKey?: string;
  startsBeforeSegment?: boolean;
  endsAfterSegment?: boolean;
  interactive?: boolean;
  readOnly?: boolean;
  eventId?: string | null;
};

function clickedSegmentDate(segment: CalendarSpanRenderSegment, event: ReactMouseEvent<HTMLButtonElement>): string {
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

function spanSegmentStyle(
  segment: CalendarSpanRenderSegment,
  layout: CalendarSpanLayoutMetrics,
  selected: boolean,
  active: boolean,
  batchSelected = false,
): CSSProperties {
  const { rowTop, height, gap } = spanLaneMetrics(layout);
  const { color } = spanSegmentDisplay(segment as CalendarSpanSegment);
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
      : batchSelected
        ? `1px solid color-mix(in srgb, ${color} 70%, rgba(255,255,255,0.16))`
      : selected
        ? `1px solid color-mix(in srgb, ${color} 52%, rgba(255,255,255,0.1))`
        : active
          ? "1px solid rgba(255,255,255,0.13)"
          : "1px solid rgba(255,255,255,0.06)",
    background: batchSelected
      ? `linear-gradient(180deg, color-mix(in srgb, ${color} 24%, transparent), color-mix(in srgb, ${color} 10%, rgba(22,22,30,0.2)))`
      : selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${color} 19%, transparent), color-mix(in srgb, ${color} 9%, transparent))`
      : active
        ? "rgba(255,255,255,0.07)"
        : "rgba(255,255,255,0.035)",
    color: selected || batchSelected ? "#f6f7fb" : "rgba(205,214,244,0.84)",
    boxShadow: batchSelected
      ? `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent), 0 0 0 1px rgba(255,255,255,0.035)`
      : selected
      ? `inset 0 1px 0 color-mix(in srgb, ${color} 18%, rgba(255,255,255,0.02))`
      : "none",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 0,
    boxSizing: "border-box",
    padding: "2px 10px",
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

function spanTitleFit(title: unknown) {
  const length = String(title || "").trim().length;
  if (length <= 24) return { fontSize: 11, lineHeight: 1.08, lineClamp: 1 };
  if (length <= 64) return { fontSize: 10.5, lineHeight: 1.08, lineClamp: 2 };
  return { fontSize: 10, lineHeight: 1.08, lineClamp: 2 };
}

function specialDateSpanTitleFit(title: unknown) {
  const fit = spanTitleFit(title);
  return { ...fit, lineClamp: 2 };
}

export default function CalendarEventSpanOverlay({
  segments,
  layout,
  weekRows,
  selectedItemId,
  activeSegmentId,
  onSetActive,
  onClearActive,
  onSelectSegment,
  quickActions,
  onBeforeAction,
}: {
  segments: CalendarSpanRenderSegment[];
  layout: CalendarSpanLayoutMetrics & { cellHeight: number; gridGap: number };
  weekRows: number;
  selectedItemId?: unknown;
  activeSegmentId?: string | null;
  onSetActive?: (segmentId: string) => void;
  onClearActive?: (segmentId: string) => void;
  onSelectSegment?: (segment: CalendarSpanSegment, meta: { triggerElement: HTMLButtonElement; dateKey: string }) => void;
  quickActions?: CalendarItemQuickActions | null;
  onBeforeAction?: () => void;
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
        gridTemplateRows: `repeat(${weekRows}, ${layout.cellHeight}px)`,
        gap: layout.gridGap,
        pointerEvents: "none",
        zIndex: 7,
      }}
    >
      {segments.map((segment) => {
        const display = spanSegmentDisplay(segment as CalendarSpanSegment);
        const compactLabel = compactLeadingLabel(display.leadingLabel);
        const leadingColumnWidth = display.specialDate ? 24 : getChipLeadingColumnWidth([{ leadingLabel: display.leadingLabel }]);
        const titleFit = display.specialDate
          ? specialDateSpanTitleFit(display.title)
          : spanTitleFit([compactLabel, display.title].filter(Boolean).join(" "));
        const selected = !!segment.eventId && String(segment.eventId) === String(selectedItemId);
        const eventItem = segment.item as SelectableCalendarEvent;
        const batchSelected = !display.specialDate && !!quickActions?.isEventSelectionSelected?.(eventItem);
        const active = activeSegmentId === segment.id;
        const commonProps = {
          "data-testid": segment.kind === "ghost" ? "calendar-ghost-chip" : "calendar-event-span-segment",
          "data-calendar-focus-ring": segment.kind === "event" ? "true" : undefined,
          "data-item-id": segment.eventId || undefined,
          "data-calendar-event-selection": batchSelected ? "true" : undefined,
          "data-calendar-event-activation": segment.kind === "event" ? "true" : undefined,
          "data-segment-start": segment.segmentStart || undefined,
          "data-segment-end": segment.segmentEnd || undefined,
          "data-span-segment-id": segment.id,
          style: spanSegmentStyle(segment, layout, selected, active, batchSelected),
        };
        const content = (
          <span
            data-calendar-span-title-fit={`${titleFit.fontSize}/${titleFit.lineClamp}`}
            style={{
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              display: "grid",
              gridTemplateColumns: leadingColumnWidth ? `${leadingColumnWidth}px minmax(0, 1fr)` : "minmax(0, 1fr)",
              alignItems: "center",
              columnGap: leadingColumnWidth ? 5 : 0,
              fontSize: titleFit.fontSize,
              fontWeight: 600,
              lineHeight: titleFit.lineHeight,
            }}
          >
            {display.specialDate ? (
              <GoogleSpecialDateBadge
                item={segment.item}
                color={display.specialDateAccent}
                selected={selected}
                active={active}
                variant="span"
              />
            ) : leadingColumnWidth ? (
              <span
                data-calendar-span-meta="true"
                style={{
                  flex: "0 0 auto",
                  width: leadingColumnWidth,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  alignSelf: "stretch",
                  maxWidth: leadingColumnWidth,
                  overflow: "hidden",
                  fontSize: 8.5,
                  lineHeight: 1,
                  fontWeight: 800,
                  letterSpacing: 0.15,
                  color: selected ? display.color : display.color || "var(--ea-accent)",
                  fontVariantNumeric: "tabular-nums",
                  verticalAlign: "baseline",
                }}
              >
                <span style={{ minWidth: 0, maxWidth: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {compactLabel}
                </span>
              </span>
            ) : null}
            <span
              style={{
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 4,
                overflow: "hidden",
              }}
            >
              {display.recurring ? (
                <Repeat
                  data-calendar-span-recurring="true"
                  aria-hidden="true"
                  size={10}
                  strokeWidth={2.4}
                  style={{
                    flex: "0 0 auto",
                    color: selected ? display.color : display.color || "var(--ea-accent)",
                    opacity: selected ? 0.86 : 0.7,
                  }}
                />
              ) : null}
              <span
                data-calendar-span-title-text="true"
                style={{
                  minWidth: 0,
                  flex: "1 1 auto",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: titleFit.lineClamp,
                  WebkitBoxOrient: "vertical",
                  overflowWrap: "break-word",
                  wordBreak: "normal",
                  whiteSpace: "normal",
                }}
              >
                {display.title}
              </span>
            </span>
          </span>
        );

        if (segment.kind === "ghost") {
          const ghost = segment.item as CalendarSpanGhost;
          return (
            <div
              key={segment.id}
              {...commonProps}
              data-ghost-kind={ghost.kind}
              data-ghost-start={ghost.startDate}
              data-ghost-end={ghost.endDate}
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
            key={segment.id}
            {...commonProps}
            type="button"
            draggable={dragAllowed}
            onClick={(event) => {
              event.stopPropagation();
              if (isEventSelectionModifier(event)) {
                event.preventDefault();
                quickActions?.toggleEventSelection?.({
                  event: eventItem,
                  dateKey: clickedSegmentDate(segment, event),
                  anchorElement: event.currentTarget,
                  sourceCellElement: event.currentTarget.closest?.("[role='gridcell']") || null,
                  anchorKind: "span",
                });
                return;
              }
              onSelectSegment?.(segment as CalendarSpanSegment, {
                triggerElement: event.currentTarget,
                dateKey: clickedSegmentDate(segment, event),
              });
            }}
            onContextMenu={(event) => {
              if (segment.readOnly || !segment.item?.writable) return;
              if (quickActions?.openContextMenu?.({
                event: eventItem,
                x: event.clientX,
                y: event.clientY,
                anchorElement: event.currentTarget,
                dateKey: clickedSegmentDate(segment, event),
                anchorKind: "span",
              })) {
                event.preventDefault();
                event.stopPropagation();
                onBeforeAction?.();
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onBeforeAction?.();
              quickActions?.openDeleteMenu?.({
                event: eventItem,
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onDragStart={(event) => {
              if (!dragAllowed || !quickActions?.beginDrag?.(eventItem)) {
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
