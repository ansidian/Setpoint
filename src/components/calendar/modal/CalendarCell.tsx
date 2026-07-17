import { createElement } from "react";
import type { ReactNode } from "react";
import CalendarSelectedCellFrame from "./CalendarSelectedCellFrame";
import { CELL_HEADER_HEIGHT, buildCellAriaLabel, formatCellDate, formatCellDateKey } from "./calendarGridUtils";
import { resolveIcon } from "../../../lib/icons";
import { isEventSelectionModifier } from "../events/calendarEventSelectionModel";
import type { CalendarGhostLike } from "./calendarGridUtils";
import type { CalendarChipItem, CalendarItemQuickActions } from "./CalendarCellItemChip";
import type { CalendarOverflowComposition } from "./useCalendarGridOverflow";

export interface CalendarCellWeather {
  high?: number | null;
  low?: number | null;
  icon?: string | null;
  summary?: string | null;
  [key: string]: unknown;
}

export interface CalendarCellQuickActions extends CalendarItemQuickActions {
  dropTargetDate?: string | null;
  deadlineDropTargetDate?: string | null;
  draggingEventId?: unknown;
  draggingDeadlineId?: unknown;
  eventSelectionActive?: boolean;
  clearEventSelection?: () => void;
  leaveDropTarget?: (dateKey: string) => void;
  leaveDeadlineDropTarget?: (dateKey: string) => void;
  enterDropTarget?: (dateKey: string) => void;
  enterDeadlineDropTarget?: (dateKey: string) => void;
  dropDeadline?: (payload: { deadline: unknown; targetDate: string }) => void;
  dropEvent?: (payload: { event: unknown; targetDate: string; anchorRect: DOMRect }) => void;
}

interface CalendarCellRenderArgs {
  items: unknown;
  ghosts: CalendarGhostLike[];
  cellMeta?: { weather?: CalendarCellWeather | null } | null;
  hasOverdue: boolean;
  isToday: boolean;
  loading?: boolean;
  pastTone?: "items" | "empty" | null;
  isSelected: boolean;
  day: number;
  selectedItemId?: unknown;
  overflowOpen: boolean;
  overflowMode: string | null;
  onSelectDay: () => void;
  onSelectItem?: (itemId: unknown, anchorMeta?: Record<string, unknown>) => void;
  onOpenOverflow?: (composition: CalendarOverflowComposition & { triggerElement: HTMLElement }) => void;
  quickActions?: CalendarCellQuickActions | null;
  dateKey: string;
}

function formatCellWeather(weather?: CalendarCellWeather | null): string | null {
  if (weather?.high == null && weather?.low == null) return null;
  return `${weather.high ?? "--"}/${weather.low ?? "--"}`;
}

function weatherIconColor(icon: unknown): string {
  const normalized = String(icon || "").toLowerCase();
  if (normalized.includes("sun") || normalized.includes("clear")) return "color-mix(in srgb, var(--sp-cream) 72%, transparent)";
  if (normalized.includes("rain") || normalized.includes("drizzle")) return "color-mix(in srgb, var(--sp-blue) 68%, transparent)";
  if (normalized.includes("snow")) return "rgba(205,214,244,0.74)";
  if (normalized.includes("storm") || normalized.includes("thunder")) return "color-mix(in srgb, var(--sp-cream) 66%, transparent)";
  return "rgba(166,173,200,0.66)";
}

export default function CalendarCell({
  isActiveMonth = true,
  view,
  viewYear,
  viewMonth,
  viewLabel,
  day,
  dateKey,
  dateLabel,
  inCurrentMonth = true,
  items,
  ghosts,
  cellMeta,
  selectedItemId,
  itemCount,
  hasItems,
  isToday,
  isSelected,
  pastTone,
  hasOverdue,
  allComplete,
  loading,
  overflowOpen = false,
  overflowMode = null,
  onSelectDay,
  onSelectDateHeader,
  onSelectItem,
  onOpenOverflow,
  renderCellContents,
  quickActions,
}: {
  isActiveMonth?: boolean;
  view: string;
  viewYear: number;
  viewMonth: number;
  viewLabel?: string;
  day: number;
  dateKey: string;
  dateLabel?: string;
  inCurrentMonth?: boolean;
  items: unknown;
  ghosts: CalendarGhostLike[];
  cellMeta?: { weather?: CalendarCellWeather | null } | null;
  selectedItemId?: unknown;
  itemCount: number;
  hasItems: boolean;
  isToday: boolean;
  isSelected: boolean;
  pastTone?: "items" | "empty" | null;
  hasOverdue?: boolean;
  allComplete?: boolean;
  loading?: boolean;
  overflowOpen?: boolean;
  overflowMode?: string | null;
  onSelectDay?: () => void;
  onSelectDateHeader?: () => void;
  onSelectItem?: (itemId: unknown, anchorMeta?: Record<string, unknown>) => void;
  onOpenOverflow?: (composition: CalendarOverflowComposition & { triggerElement: HTMLElement }) => void;
  renderCellContents?: (args: CalendarCellRenderArgs) => ReactNode;
  quickActions?: CalendarCellQuickActions | null;
}) {
  const todayAccent = "var(--ea-accent)";
  const inlineOverflowOpen = overflowOpen && overflowMode === "inline";
  let cellBg = "rgba(255,255,255,0.015)";
  let cellBorder = "1px solid rgba(255,255,255,0.04)";
  let cellShadow = "none";
  let dateColor = "rgba(205,214,244,0.7)";
  let dateWeight = 400;
  let accentBar = null;
  let todayWash = null;
  let dateBadgeBg = "transparent";
  let dateBadgeBorder = "1px solid transparent";
  let dateBadgeShadow = "none";

  if (!inCurrentMonth) {
    cellBg = "rgba(255,255,255,0.008)";
    cellBorder = "1px solid rgba(255,255,255,0.022)";
    dateColor = "var(--color-text-faint)";
  }

  if (isSelected) {
    cellBg = "color-mix(in srgb, var(--sp-accent) 6%, transparent)";
    cellBorder = "1px solid color-mix(in srgb, var(--sp-accent) 40%, transparent)";
    cellShadow =
      "0 0 0 1px color-mix(in srgb, var(--sp-accent) 18%, transparent), 0 4px 14px color-mix(in srgb, var(--sp-accent) 18%, transparent)";
    dateColor = "var(--sp-accent)";
    dateWeight = 600;
  } else if (allComplete) {
    accentBar = "var(--sp-green)";
    dateColor = "color-mix(in srgb, var(--sp-green) 85%, transparent)";
  } else if (hasOverdue) {
    accentBar = "var(--sp-rose)";
    dateColor = "color-mix(in srgb, var(--sp-rose) 90%, transparent)";
  } else if (hasItems) {
    dateColor = "var(--sp-text)";
    dateWeight = 500;
  }

  if (!isSelected && !isToday && pastTone) {
    cellBg =
      pastTone === "items"
        ? "rgba(255,255,255,0.01)"
        : "rgba(255,255,255,0.006)";
    cellBorder =
      pastTone === "items"
        ? "1px solid rgba(255,255,255,0.028)"
        : "1px solid rgba(255,255,255,0.022)";
    dateColor =
      pastTone === "items"
        ? "var(--color-text-faint)"
        : "var(--color-text-faint)";
    if (!hasItems) dateWeight = 400;
  }

  // Hover treatment (PERF-L03) is expressed in CSS (see index.css,
  // `[data-calcell="true"]:hover`) rather than React state, so hovering a
  // cell never re-renders it or re-invokes renderCellContents. The CSS rules
  // reproduce the two backgrounds/border above, keyed on `data-selected`/
  // `data-current-month`, and are suppressed via `:not()` guards when
  // `data-drop-target` is set, or when `data-overflow-open`+`data-overflow-mode`
  // together indicate inline overflow (mirroring `inlineOverflowOpen` below —
  // fallback/popover overflow does NOT suppress hover), matching the
  // priority order below (those states still win over hover).

  if (inlineOverflowOpen) {
    cellBg = "color-mix(in srgb, var(--sp-panel) 98%, transparent)";
    cellBorder = "1px solid rgba(255,255,255,0.12)";
    cellShadow = "0 16px 36px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.05)";
  }

  const isDropTarget = quickActions?.dropTargetDate === dateKey
    || quickActions?.deadlineDropTargetDate === dateKey;
  if (isDropTarget) {
    cellBg = "color-mix(in srgb, var(--sp-accent) 10%, transparent)";
    cellBorder = "1px solid color-mix(in srgb, var(--sp-accent) 58%, transparent)";
    cellShadow =
      "0 0 0 1px color-mix(in srgb, var(--sp-accent) 20%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--sp-accent) 8%, transparent)";
  }

  if (isToday) {
    todayWash = isSelected
      ? `linear-gradient(180deg, color-mix(in srgb, ${todayAccent} 16%, transparent), color-mix(in srgb, ${todayAccent} 6%, transparent) 56%, transparent)`
      : `linear-gradient(180deg, color-mix(in srgb, ${todayAccent} 20%, transparent), color-mix(in srgb, ${todayAccent} 8%, transparent) 58%, transparent)`;
    dateColor = isSelected ? "#ffffff" : todayAccent;
    dateWeight = 700;
    dateBadgeBg = isSelected
      ? `color-mix(in srgb, ${todayAccent} 32%, transparent)`
      : `color-mix(in srgb, ${todayAccent} 18%, transparent)`;
    dateBadgeBorder = isSelected
      ? `1px solid color-mix(in srgb, ${todayAccent} 56%, white 12%)`
      : `1px solid color-mix(in srgb, ${todayAccent} 42%, transparent)`;
    dateBadgeShadow = isSelected
      ? `0 0 0 1px color-mix(in srgb, ${todayAccent} 18%, transparent), 0 6px 18px color-mix(in srgb, ${todayAccent} 24%, transparent)`
      : `0 4px 12px color-mix(in srgb, ${todayAccent} 18%, transparent)`;
  }

  const renderedCellContents = renderCellContents?.({
    items,
    ghosts,
    cellMeta,
    hasOverdue: !!hasOverdue,
    isToday,
    loading,
    pastTone,
    isSelected,
    day,
    selectedItemId,
    overflowOpen,
    overflowMode,
    onSelectDay: () => onSelectDay?.(),
    onSelectItem,
    onOpenOverflow,
    quickActions,
    dateKey,
  });
  const ariaLabel = buildCellAriaLabel({
    viewLabel,
    viewYear,
    viewMonth,
    day,
    dateKey,
    itemCount,
    isSelected,
    isToday,
  });
  const weatherLabel = formatCellWeather(cellMeta?.weather);
  const WeatherIcon = weatherLabel ? resolveIcon(cellMeta?.weather?.icon) : null;
  const resolvedWeatherIconColor = weatherIconColor(cellMeta?.weather?.icon);

  return (
    <div
      onClick={(event) => {
        if (isEventSelectionModifier(event)) return;
        onSelectDay?.();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onSelectDay?.();
      }}
      role="gridcell"
      aria-roledescription="calendar day"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-current={isToday ? "date" : undefined}
      aria-selected={isSelected}
      data-calendar-focus-ring="true"
      data-testid={
        isActiveMonth
          ? (inCurrentMonth ? `calendar-cell-${day}` : `calendar-cell-${dateKey}`)
          : (inCurrentMonth ? `calendar-cell-${dateKey}` : undefined)
      }
      data-date-key={dateKey || undefined}
      data-calcell="true"
      data-selected={isSelected ? "true" : "false"}
      data-current-month={inCurrentMonth ? "true" : "false"}
      data-past-tone={pastTone || "none"}
      data-overflow-open={overflowOpen ? "true" : "false"}
      data-overflow-mode={overflowMode || "none"}
      data-drop-target={isDropTarget ? "true" : "false"}
      onPointerLeave={() => {
        quickActions?.leaveDropTarget?.(dateKey);
        quickActions?.leaveDeadlineDropTarget?.(dateKey);
      }}
      onDragEnter={(event) => {
        const dragging = quickActions?.draggingEventId || quickActions?.draggingDeadlineId;
        if (!dragging || !dateKey) return;
        event.preventDefault();
        if (quickActions.draggingDeadlineId) quickActions.enterDeadlineDropTarget?.(dateKey);
        else quickActions.enterDropTarget?.(dateKey);
      }}
      onDragOver={(event) => {
        if ((!quickActions?.draggingEventId && !quickActions?.draggingDeadlineId) || !dateKey) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        const dragging = quickActions?.draggingEventId || quickActions?.draggingDeadlineId;
        if (!dragging || !dateKey) return;
        event.preventDefault();
        const deadlinePayload = event.dataTransfer?.getData(
          "application/x-ea-calendar-deadline",
        );
        if (deadlinePayload) {
          let deadline = null;
          try {
            deadline = JSON.parse(deadlinePayload);
          } catch {
            deadline = null;
          }
          quickActions.dropDeadline?.({ deadline, targetDate: dateKey });
          return;
        }
        const payload = event.dataTransfer?.getData(
          "application/x-ea-calendar-event",
        );
        let droppedEvent = null;
        try {
          droppedEvent = payload ? JSON.parse(payload) : null;
        } catch {
          droppedEvent = null;
        }
        quickActions.dropEvent?.({
          event: droppedEvent,
          targetDate: dateKey,
          anchorRect: event.currentTarget.getBoundingClientRect(),
        });
      }}
      style={{
        position: "relative",
        minWidth: 0,
        overflow: "hidden",
        borderRadius: 8,
        padding: "6px 8px",
        background: cellBg,
        border: cellBorder,
        boxShadow: cellShadow,
        cursor: "pointer",
        transition:
          "box-shadow 150ms, border-color 150ms, background 150ms",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {todayWash && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 1,
            borderRadius: 7,
            background: todayWash,
            pointerEvents: "none",
          }}
        />
      )}
      {accentBar && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            background: accentBar,
            borderRadius: 2,
            opacity: 0.55,
          }}
        />
      )}
      <div
        data-testid="calendar-cell-header"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          minHeight: CELL_HEADER_HEIGHT,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          data-testid={`calendar-cell-date-header-${dateKey || day}`}
          data-calendar-focus-ring="true"
          aria-label={`Select ${dateKey ? formatCellDateKey(dateKey) : formatCellDate(viewYear, viewMonth, day)}`}
          onClick={(event) => {
            event.stopPropagation();
            if (isEventSelectionModifier(event)) return;
            onSelectDateHeader?.();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: isToday ? 24 : undefined,
            height: isToday ? 24 : undefined,
            padding: isToday ? "0 8px" : 0,
            margin: 0,
            borderRadius: 999,
            fontSize: 12.5,
            lineHeight: 1,
            color: dateColor,
            fontWeight: dateWeight,
            fontVariantNumeric: "tabular-nums",
            appearance: "none",
            background: dateBadgeBg,
            border: dateBadgeBorder,
            boxShadow: dateBadgeShadow,
            fontFamily: "inherit",
            cursor: "pointer",
            transition:
              "background 150ms, border-color 150ms, box-shadow 150ms",
          }}
        >
          {dateLabel || day}
        </button>
        {weatherLabel ? (
          <span
            data-testid="calendar-cell-weather"
            aria-label={cellMeta?.weather?.summary || "Weather forecast"}
            title={cellMeta?.weather?.summary || "Weather forecast"}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              color: "var(--color-text-faint)",
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {WeatherIcon ? createElement(WeatherIcon, {
              size: 10,
              strokeWidth: 2,
              color: resolvedWeatherIconColor,
              "aria-hidden": "true",
            }) : null}
            {weatherLabel}
          </span>
        ) : null}
      </div>
      <div
        style={{
          position: "relative",
          minHeight: 0,
          flex: 1,
          overflow: inlineOverflowOpen ? "visible" : "hidden",
        }}
      >
        <CalendarSelectedCellFrame
          view={view}
          selected={isSelected}
          isEmpty={!hasItems}
          pastTone={pastTone}
          isToday={isToday}
        >
          {renderedCellContents}
        </CalendarSelectedCellFrame>
      </div>
    </div>
  );
}
