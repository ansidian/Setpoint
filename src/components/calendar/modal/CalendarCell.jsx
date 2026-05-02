import { useState } from "react";
import CalendarSelectedCellFrame from "./CalendarSelectedCellFrame.jsx";
import { CELL_HEADER_HEIGHT, buildCellAriaLabel, formatCellDate, formatCellDateKey } from "./calendarGridUtils.js";

export default function CalendarCell({
  view,
  viewYear,
  viewMonth,
  viewLabel,
  day,
  dateKey,
  dateLabel,
  inCurrentMonth = true,
  boundarySides = [],
  items,
  ghosts,
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
}) {
  const [hovered, setHovered] = useState(false);
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
    dateColor = "rgba(205,214,244,0.34)";
  }

  if (isSelected) {
    cellBg = "rgba(203,166,218,0.06)";
    cellBorder = "1px solid rgba(203,166,218,0.4)";
    cellShadow =
      "0 0 0 1px rgba(203,166,218,0.18), 0 4px 14px rgba(203,166,218,0.18)";
    dateColor = "#cba6da";
    dateWeight = 600;
  } else if (allComplete) {
    accentBar = "#a6e3a1";
    dateColor = "rgba(166,227,161,0.85)";
  } else if (hasOverdue) {
    accentBar = "#f38ba8";
    dateColor = "rgba(243,139,168,0.9)";
  } else if (hasItems) {
    dateColor = "#cdd6f4";
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
        ? "rgba(205,214,244,0.48)"
        : "rgba(205,214,244,0.33)";
    if (!hasItems) dateWeight = 400;
  }

  if (!isSelected && hovered) {
    cellBg = inCurrentMonth
      ? "rgba(255,255,255,0.035)"
      : "rgba(255,255,255,0.018)";
    cellBorder = "1px solid rgba(255,255,255,0.085)";
  }

  if (inlineOverflowOpen) {
    cellBg = "rgba(22,22,30,0.98)";
    cellBorder = "1px solid rgba(255,255,255,0.12)";
    cellShadow = "0 16px 36px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.05)";
  }

  const isDropTarget = quickActions?.dropTargetDate === dateKey;
  if (isDropTarget) {
    cellBg = "rgba(203,166,218,0.10)";
    cellBorder = "1px solid rgba(203,166,218,0.58)";
    cellShadow =
      "0 0 0 1px rgba(203,166,218,0.20), inset 0 0 0 1px rgba(203,166,218,0.08)";
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
    hasOverdue,
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

  return (
    <div
      onClick={() => onSelectDay?.()}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
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
        inCurrentMonth ? `calendar-cell-${day}` : `calendar-cell-${dateKey}`
      }
      data-date-key={dateKey || undefined}
      data-current-month={inCurrentMonth ? "true" : "false"}
      data-boundary-side={
        boundarySides.length ? boundarySides.join(" ") : "none"
      }
      data-past-tone={pastTone || "none"}
      data-overflow-open={overflowOpen ? "true" : "false"}
      data-overflow-mode={overflowMode || "none"}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        quickActions?.leaveDropTarget?.(dateKey);
      }}
      onDragEnter={(event) => {
        if (!quickActions?.draggingEventId || !dateKey) return;
        event.preventDefault();
        quickActions.enterDropTarget(dateKey);
      }}
      onDragOver={(event) => {
        if (!quickActions?.draggingEventId || !dateKey) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (!quickActions?.draggingEventId || !dateKey) return;
        event.preventDefault();
        const payload = event.dataTransfer?.getData(
          "application/x-ea-calendar-event",
        );
        let droppedEvent = null;
        try {
          droppedEvent = payload ? JSON.parse(payload) : null;
        } catch {
          droppedEvent = null;
        }
        quickActions.dropEvent({
          event: droppedEvent,
          targetDate: dateKey,
          anchorRect: event.currentTarget.getBoundingClientRect(),
        });
      }}
      style={{
        position: "relative",
        minWidth: 0,
        overflow: "visible",
        borderRadius: 8,
        padding: "6px 8px",
        background: cellBg,
        border: cellBorder,
        boxShadow: cellShadow,
        cursor: "pointer",
        opacity: inCurrentMonth ? 1 : 0.68,
        transition:
          "box-shadow 150ms, border-color 150ms, background 150ms, opacity 150ms",
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
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
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
