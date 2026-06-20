import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseYmd } from "../../calendarDateUtils.js";
import { buildMiniCalendarModel } from "./miniCalendarModel.js";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const TODAY_BLUE = "#0495FF";
const TITLE_MONTH_WHITE = "#f8faff";
const TITLE_YEAR_RED = "#ff453a";
const MARKER_RING_DARK = "rgba(14, 15, 22, 0.74)";
const MARKER_RING_LIGHT = "rgba(248, 250, 255, 0.82)";
const MARKER_RING_CONTRAST_THRESHOLD = 3;

function formatMonthParts(viewYear, viewMonth) {
  const date = new Date(viewYear, viewMonth, 1);
  return {
    month: date.toLocaleDateString("en-US", { month: "long" }),
    year: date.toLocaleDateString("en-US", { year: "numeric" }),
  };
}

function formatDateLabel(dateKey) {
  const parsed = parseYmd(dateKey);
  if (!parsed) return dateKey || "Date";
  return new Date(parsed.year, parsed.month, parsed.day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function dateTone(cell) {
  if (cell.isToday) return "today";
  if (!cell.inCurrentMonth) return "adjacent";
  return "current";
}

function dateFill(cell) {
  if (cell.hoverPreview) return "hover-preview";
  if (cell.isSelected && cell.isToday) return "today-selected";
  if (cell.isSelected) return "selected";
  return "none";
}

function dateTextColor(cell) {
  if (cell.hoverPreview) return "rgba(248,250,255,0.98)";
  if (cell.isSelected) return "rgba(248,250,255,0.96)";
  if (cell.isToday) return TODAY_BLUE;
  if (!cell.inCurrentMonth) return "var(--color-text-faint)";
  return "rgba(248,250,255,0.9)";
}

function dateCellBackground(cell) {
  if (cell.hoverPreview) {
    if (cell.hoverPreview.isMultiDayAllDay) return "transparent";
    return cell.hoverPreview.color;
  }
  if (cell.isSelected && cell.isToday) return TODAY_BLUE;
  if (cell.isSelected) return "rgba(177,177,179,0.72)";
  return "transparent";
}

function parseCssColor(value) {
  const color = String(value || "").trim();
  if (!color || color === "transparent") return null;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((part) => part + part).join("")
      : hex[1];
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (!rgb) return null;
  const [r, g, b] = rgb[1].split(",").map((part) => Number.parseFloat(part.trim()));
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b };
}

function linearChannel(channel) {
  const value = Math.max(0, Math.min(255, channel)) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color) {
  return (
    0.2126 * linearChannel(color.r)
    + 0.7152 * linearChannel(color.g)
    + 0.0722 * linearChannel(color.b)
  );
}

function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function markerContrastRing(markerColor, backdropColor) {
  const marker = parseCssColor(markerColor);
  const backdrop = parseCssColor(backdropColor);
  if (!marker || !backdrop || contrastRatio(marker, backdrop) >= MARKER_RING_CONTRAST_THRESHOLD) {
    return null;
  }

  const dark = { r: 14, g: 15, b: 22 };
  const light = { r: 248, g: 250, b: 255 };
  return contrastRatio(dark, backdrop) >= contrastRatio(light, backdrop)
    ? { tone: "dark", color: MARKER_RING_DARK }
    : { tone: "light", color: MARKER_RING_LIGHT };
}

function dateAriaLabel(cell) {
  return [
    formatDateLabel(cell.dateKey),
    cell.isToday ? "today" : null,
    cell.isSelected ? "selected" : null,
  ].filter(Boolean).join(", ");
}

function Marker({ marker, backdropColor = null }) {
  const size = marker.kind === "deadline" ? 9 : 4;
  const ring = markerContrastRing(marker.color, backdropColor);
  return (
    <span
      data-testid="calendar-mini-calendar-marker"
      data-marker-kind={marker.kind}
      data-marker-color={marker.color}
      data-marker-count={marker.count}
      data-marker-overflow={marker.representsOverflow ? "true" : "false"}
      data-marker-contrast-ring={ring?.tone || undefined}
      aria-hidden="true"
      style={{
        width: size,
        height: marker.kind === "deadline" ? 8 : size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: marker.color,
        background: marker.kind === "deadline" ? "transparent" : marker.color,
        borderRadius: 999,
        fontSize: 8,
        fontWeight: 900,
        lineHeight: 1,
        flex: "0 0 auto",
        boxShadow: marker.kind === "deadline" || !ring ? "none" : `0 0 0 1.5px ${ring.color}`,
        textShadow: marker.kind === "deadline" && ring
          ? `0 0 2px ${ring.color}, 0 0 1px ${ring.color}`
          : "none",
      }}
    >
      {marker.kind === "deadline" ? "✓" : null}
    </span>
  );
}

export function AgendaRailWithMiniCalendar({ miniCalendar, children }) {
  return (
    <div
      data-testid="calendar-agenda-mini-calendar-shell"
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--sp-panel)",
        isolation: "isolate",
      }}
    >
      {miniCalendar}
      {children}
    </div>
  );
}

export default function MiniCalendar({
  viewYear,
  viewMonth,
  todayKey,
  selectedDateKey,
  activatedDateKey = null,
  activityItems = [],
  hoverPreviewItem = null,
  canGoPrev = true,
  onPreviousMonth,
  onNextMonth,
  onDateAction,
  onDateCreate,
}) {
  const model = useMemo(() => buildMiniCalendarModel({
    viewYear,
    viewMonth,
    todayKey,
    selectedDateKey,
    activatedDateKey,
    activityItems,
    hoverPreviewItem,
  }), [activatedDateKey, activityItems, hoverPreviewItem, selectedDateKey, todayKey, viewMonth, viewYear]);
  const monthTitle = useMemo(() => formatMonthParts(viewYear, viewMonth), [viewMonth, viewYear]);
  const previousDisabled = !canGoPrev || !onPreviousMonth;
  const nextDisabled = !onNextMonth;
  const markerBackdropColor = (cell) => {
    if (cell.hoverPreview) return cell.hoverPreview.color;
    if (cell.isSelected && cell.isToday) return TODAY_BLUE;
    if (cell.isSelected) return "rgba(177,177,179,0.72)";
    return null;
  };

  return (
    <section
      data-testid="calendar-mini-calendar"
      data-row-count="6"
      aria-label="Mini Calendar"
      onWheel={(event) => {
        event.stopPropagation();
      }}
      style={{
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 12px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))",
      }}
    >
      <style>
        {`
          [data-testid="calendar-mini-calendar"] .mini-calendar-control,
          [data-testid="calendar-mini-calendar"] .mini-calendar-date,
          [data-testid="calendar-mini-calendar"] .mini-calendar-hover-preview {
            transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), background-color 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
          }
          [data-testid="calendar-mini-calendar"] .mini-calendar-control:not(:disabled):hover,
          [data-testid="calendar-mini-calendar"] .mini-calendar-date:not(:disabled):hover {
            transform: translateY(-1px);
            border-color: rgba(255,255,255,0.16);
            background-color: rgba(255,255,255,0.06);
          }
          [data-testid="calendar-mini-calendar"] .mini-calendar-control:not(:disabled):active,
          [data-testid="calendar-mini-calendar"] .mini-calendar-date:not(:disabled):active {
            transform: translateY(0);
          }
          [data-testid="calendar-mini-calendar"] button:focus-visible {
            outline: 2px solid color-mix(in srgb, var(--ea-accent, var(--sp-accent)) 72%, transparent);
            outline-offset: 2px;
          }
          @media (prefers-reduced-motion: reduce) {
            [data-testid="calendar-mini-calendar"] .mini-calendar-control,
            [data-testid="calendar-mini-calendar"] .mini-calendar-date,
            [data-testid="calendar-mini-calendar"] .mini-calendar-hover-preview {
              transition: none !important;
              transform: none !important;
            }
          }
        `}
      </style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button
          type="button"
          className="mini-calendar-control"
          aria-label="Previous Mini Calendar month"
          disabled={previousDisabled}
          onClick={onPreviousMonth}
          data-calendar-focus-ring="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.035)",
            color: previousDisabled ? "rgba(166,173,200,0.34)" : "rgba(205,214,244,0.84)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: previousDisabled ? "default" : "pointer",
          }}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <div
          style={{
            minWidth: 0,
            display: "inline-flex",
            alignItems: "baseline",
            justifyContent: "center",
            gap: 5,
            fontSize: 13,
            fontWeight: 760,
            letterSpacing: 0,
            lineHeight: 1,
            textTransform: "none",
          }}
        >
          <span data-testid="calendar-mini-calendar-month-label" style={{ color: TITLE_MONTH_WHITE }}>
            {monthTitle.month}
          </span>
          <span data-testid="calendar-mini-calendar-year-label" style={{ color: TITLE_YEAR_RED, fontWeight: 640 }}>
            {monthTitle.year}
          </span>
        </div>
        <button
          type="button"
          className="mini-calendar-control"
          aria-label="Next Mini Calendar month"
          disabled={nextDisabled}
          onClick={onNextMonth}
          data-calendar-focus-ring="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.035)",
            color: nextDisabled ? "rgba(166,173,200,0.34)" : "rgba(205,214,244,0.84)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: nextDisabled ? "default" : "pointer",
          }}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 2,
          color: "rgba(166,173,200,0.75)",
          fontSize: 9,
          fontWeight: 800,
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gridTemplateRows: "repeat(6, 28px)",
          gap: 2,
        }}
      >
        {model.hoverPreview?.isMultiDayAllDay
          ? model.hoverPreview.segments.map((segment) => {
            const leftRadius = segment.startsBeforeSegment ? 5 : 999;
            const rightRadius = segment.endsAfterSegment ? 5 : 999;
            return (
              <span
                key={`${model.hoverPreview.itemId || "preview"}-${segment.segmentStart}-${segment.segmentEnd}`}
                className="mini-calendar-hover-preview"
                data-testid="calendar-mini-calendar-hover-preview"
                data-preview-item-id={model.hoverPreview.itemId || undefined}
                data-preview-color={model.hoverPreview.color}
                data-segment-start={segment.segmentStart}
                data-segment-end={segment.segmentEnd}
                aria-hidden="true"
                style={{
                  gridColumn: `${segment.columnStart + 1} / ${segment.columnEnd + 1}`,
                  gridRow: segment.rowIndex + 1,
                  alignSelf: "stretch",
                  height: 26,
                  margin: "1px 0",
                  borderRadius: `${leftRadius}px ${rightRadius}px ${rightRadius}px ${leftRadius}px`,
                  border: "0",
                  background: model.hoverPreview.color,
                  boxShadow: "none",
                  opacity: 1,
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              />
            );
          })
          : null}
        {model.cells.map((cell) => (
          <button
            key={cell.dateKey}
            type="button"
            className="mini-calendar-date"
            data-testid="calendar-mini-calendar-date"
            data-date-key={cell.dateKey}
            data-date-tone={dateTone(cell)}
            data-date-fill={dateFill(cell)}
            data-hover-preview={cell.hoverPreview ? "active" : undefined}
            data-hover-preview-color={cell.hoverPreview?.color || undefined}
            data-current-month={cell.inCurrentMonth ? "true" : "false"}
            data-adjacent-position={cell.adjacentPosition}
            data-calendar-focus-ring="true"
            aria-label={dateAriaLabel(cell)}
            onClick={() => onDateAction?.(cell.dateKey)}
            onDoubleClick={() => onDateCreate?.(cell.dateKey)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onDateAction?.(cell.dateKey);
            }}
            style={{
              minWidth: 0,
              minHeight: 0,
              gridColumn: cell.weekdayIndex + 1,
              gridRow: cell.rowIndex + 1,
              position: "relative",
              zIndex: cell.hoverPreview ? 2 : 1,
              display: "grid",
              gridTemplateRows: "minmax(15px, auto) 7px",
              alignContent: "center",
              alignItems: "center",
              justifyItems: "center",
              gap: 1,
              border: "1px solid transparent",
              borderRadius: 7,
              background: dateCellBackground(cell),
              color: dateTextColor(cell),
              cursor: onDateAction || onDateCreate ? "pointer" : "default",
              padding: 0,
              fontFamily: "inherit",
              lineHeight: 1,
            }}
          >
            <span
              data-testid="calendar-mini-calendar-date-number"
              style={{
                minWidth: cell.isSelected || cell.hoverPreview ? 20 : 18,
                height: cell.isSelected || cell.hoverPreview ? 20 : 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                background: "transparent",
                color: dateTextColor(cell),
                fontSize: cell.isSelected || cell.hoverPreview ? 12 : 11,
                fontWeight: cell.isToday || cell.isSelected || cell.hoverPreview ? 850 : 720,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {cell.day}
            </span>
            <span
              style={{
                minHeight: 5,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
              }}
            >
              {cell.markers.map((marker, index) => (
                <Marker
                  key={`${cell.dateKey}-${marker.kind}-${marker.itemId}-${index}`}
                  marker={marker}
                  backdropColor={markerBackdropColor(cell)}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
