import { useCallback, useRef, useState } from "react";
import type { ComponentType, CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import CalendarJumpToMonth from "./CalendarJumpToMonth";
import type useCalendarEventEditor from "../events/useCalendarEventEditor";
import type { CalendarModalSearchController } from "../../../hooks/calendar/useCalendarModalSearch";

const TITLE_MONTH_WHITE = "#f8faff";
const TITLE_YEAR_RED = "#ff453a";

function parseDateKey(dateKey: unknown): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
  };
}

function formatSelectedDate(
  viewYear: number,
  viewMonth: number,
  selectedDay?: number | null,
  selectedDateKey?: string | null,
): string | null {
  const parsed = parseDateKey(selectedDateKey);
  if (!selectedDay && !parsed) return null;
  const day = parsed?.day ?? selectedDay;
  if (day == null) return null;
  return new Date(parsed?.year ?? viewYear, parsed?.month ?? viewMonth, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function selectedDateYmd(
  viewYear: number,
  viewMonth: number,
  selectedDay?: number | null,
  selectedDateKey?: string | null,
): string | null {
  if (selectedDateKey) return selectedDateKey;
  if (!selectedDay) return null;
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
}

function headerButtonBaseStyle(): CSSProperties {
  return {
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    fontFamily: "inherit",
    transform: "translateY(0)",
    transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms",
  };
}

function handleHeaderButtonHover(event: ReactMouseEvent<HTMLButtonElement>, active: boolean): void {
  if (active === false) return;
  event.currentTarget.style.background = "rgba(255,255,255,0.06)";
  event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
  event.currentTarget.style.transform = "translateY(-1px)";
}

function resetHeaderButtonHover(event: ReactMouseEvent<HTMLButtonElement>, active = false): void {
  event.currentTarget.style.background = active ? "color-mix(in srgb, var(--sp-accent) 12%, transparent)" : "rgba(255,255,255,0.03)";
  event.currentTarget.style.borderColor = active ? "color-mix(in srgb, var(--sp-accent) 28%, transparent)" : "rgba(255,255,255,0.06)";
  event.currentTarget.style.transform = "translateY(0)";
}

export default function CalendarModalHeader({
  monthName,
  monthYear,
  layout,
  canGoPrev,
  navigateMonth,
  jumpToMonth,
  currentYear,
  currentMonth,
  HeaderExtras,
  viewData,
  computed,
  eventEditor,
  selectedDay,
  selectedDateKey,
  viewYear,
  viewMonth,
  setDeadlineEditor,
  viewLabel,
  search,
}: {
  view: string;
  monthName: string;
  monthYear: string | number;
  layout: {
    tier?: string;
    shellPadding: number;
    contentGap: number;
    headerStacked?: boolean;
    headerWrap?: boolean;
  };
  canGoPrev: boolean;
  navigateMonth: (offset: number) => void;
  jumpToMonth?: (year: number, month: number) => void;
  currentYear: number;
  currentMonth: number;
  onViewChange?: (view: string) => void;
  availableCalendarViews?: string[];
  HeaderExtras?: ComponentType<Record<string, unknown>> | null;
  viewData?: { pendingUpdate?: boolean } | null;
  computed?: unknown;
  eventEditor: ReturnType<typeof useCalendarEventEditor>;
  selectedDay?: number | null;
  selectedDateKey?: string | null;
  viewYear: number;
  viewMonth: number;
  setDeadlineEditor: (editor: Record<string, unknown> | null) => void;
  viewLabel?: string;
  search?: CalendarModalSearchController | null;
}) {
  const titleSize = layout.tier === "uhd" ? 40 : layout.tier === "xl" ? 40 : layout.tier === "lg" ? 36 : layout.tier === "md" ? 32 : 28;
  const selectedDateLabel = formatSelectedDate(viewYear, viewMonth, selectedDay, selectedDateKey);
  const selectedDate = selectedDateYmd(viewYear, viewMonth, selectedDay, selectedDateKey);
  const showPendingUpdate = !!viewData?.pendingUpdate;

  const titleRef = useRef<HTMLButtonElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleTitleClick = useCallback(() => {
    setPickerOpen((open) => !open);
  }, []);

  const handlePickerSelect = useCallback((year: number, month: number) => {
    setPickerOpen(false);
    jumpToMonth?.(year, month);
  }, [jumpToMonth]);

  const handlePickerClose = useCallback(() => {
    setPickerOpen(false);
  }, []);

  return (
    <div
      style={{
        position: "sticky",
        top: -layout.shellPadding,
        zIndex: 2,
        margin: `${-layout.shellPadding}px ${-layout.shellPadding}px 0`,
        padding: `${layout.shellPadding}px ${layout.shellPadding}px ${layout.contentGap}px`,
        background: "linear-gradient(180deg, color-mix(in srgb, var(--sp-panel) 98%, transparent), color-mix(in srgb, var(--sp-panel) 94%, transparent) 72%, color-mix(in srgb, var(--sp-panel) 0%, transparent))",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: layout.headerStacked ? "minmax(0, 1fr) auto" : "minmax(0, 1fr) auto minmax(0, 1fr)",
          gridTemplateAreas: layout.headerStacked
            ? "\"title actions\" \"views views\""
            : "\"title views actions\"",
          alignItems: "center",
          gap: layout.headerStacked ? 12 : 16,
        }}
      >
        <div
          style={{
            gridArea: "title",
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            alignItems: "center",
            gap: layout.tier === "xl" ? 20 : 16,
            justifySelf: "start",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignSelf: "start" }}>
            <button
              type="button"
              onClick={() => canGoPrev && navigateMonth(-1)}
              aria-label="Previous month"
              aria-disabled={!canGoPrev}
              disabled={!canGoPrev}
              data-calendar-month-navigation="true"
              onMouseEnter={(event) => handleHeaderButtonHover(event, canGoPrev)}
              onMouseLeave={resetHeaderButtonHover}
              data-calendar-focus-ring="true"
              style={{
                ...headerButtonBaseStyle(),
                color: canGoPrev ? "rgba(205,214,244,0.7)" : "rgba(205,214,244,0.18)",
                cursor: canGoPrev ? "pointer" : "default",
                flexShrink: 0,
              }}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              onClick={() => navigateMonth(1)}
              aria-label="Next month"
              data-calendar-month-navigation="true"
              onMouseEnter={(event) => handleHeaderButtonHover(event, true)}
              onMouseLeave={resetHeaderButtonHover}
              data-calendar-focus-ring="true"
              style={{
                ...headerButtonBaseStyle(),
                color: "rgba(205,214,244,0.7)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 2.2,
                textTransform: "uppercase",
                color: "var(--color-text-faint)",
              }}
            >
              Calendar Workspace · {viewLabel || "Events"}
            </div>
            <button
              ref={titleRef}
              type="button"
              id="calendar-modal-title"
              data-testid="calendar-month-title"
              onClick={handleTitleClick}
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                const chevron = e.currentTarget.querySelector<HTMLElement>("[data-title-chevron]");
                if (chevron) chevron.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                if (!pickerOpen) {
                  e.currentTarget.style.background = "transparent";
                  const chevron = e.currentTarget.querySelector<HTMLElement>("[data-title-chevron]");
                  if (chevron) chevron.style.opacity = "0";
                }
              }}
              style={{
                fontSize: titleSize,
                fontWeight: 600,
                color: TITLE_MONTH_WHITE,
                letterSpacing: -0.7,
                lineHeight: 0.96,
                whiteSpace: layout.headerWrap ? "normal" : "nowrap",
                cursor: "pointer",
                background: pickerOpen ? "rgba(255,255,255,0.04)" : "transparent",
                border: "none",
                borderRadius: 8,
                padding: "4px 8px",
                margin: "-4px -8px",
                fontFamily: "inherit",
                textAlign: "left",
                display: "inline-flex",
                alignItems: "baseline",
                gap: 6,
                transition: "background 140ms",
              }}
            >
              <span data-testid="calendar-month-title-month" style={{ color: TITLE_MONTH_WHITE }}>
                {monthName}
              </span>{" "}
              <span data-testid="calendar-month-title-year" style={{ color: TITLE_YEAR_RED, fontWeight: 400 }}>
                {monthYear}
              </span>
              <ChevronDown
                data-title-chevron=""
                size={titleSize * 0.45}
                strokeWidth={2.2}
                style={{
                  color: "rgba(205,214,244,0.45)",
                  opacity: pickerOpen ? 1 : 0,
                  transition: "opacity 140ms, transform 140ms",
                  transform: pickerOpen ? "rotate(180deg)" : "rotate(0)",
                  flexShrink: 0,
                }}
              />
            </button>
            {pickerOpen ? (
              <CalendarJumpToMonth
                anchorRef={titleRef}
                viewYear={viewYear}
                viewMonth={viewMonth}
                currentYear={currentYear}
                currentMonth={currentMonth}
                onSelect={handlePickerSelect}
                onClose={handlePickerClose}
              />
            ) : null}
          </div>
        </div>

        <div style={{ gridArea: "views" }} />

        <div
          style={{
            gridArea: "actions",
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifySelf: "end",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {showPendingUpdate ? (
              <div
                data-testid="calendar-pending-update"
                role="status"
                aria-live="polite"
                aria-label="Calendar updates pending"
                title="Calendar updates pending"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid color-mix(in srgb, var(--sp-blue) 18%, transparent)",
                  background: "color-mix(in srgb, var(--sp-blue) 8%, transparent)",
                  color: "rgba(205,214,244,0.72)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
                }}
              >
                <RefreshCw
                  className="calendar-pending-update-icon"
                  data-testid="calendar-pending-update-icon"
                  size={13}
                  aria-hidden="true"
                  strokeWidth={1.8}
                />
              </div>
            ) : null}
            {HeaderExtras ? (
              <HeaderExtras
                data={viewData}
                computed={computed}
                editor={eventEditor}
                selectedDay={selectedDay}
                selectedDate={selectedDate}
                selectedDateLabel={selectedDateLabel}
                viewYear={viewYear}
                viewMonth={viewMonth}
                onCreateTask={(seedDate: unknown) => {
                  setDeadlineEditor({
                    mode: "create",
                    seedDate: seedDate || null,
                  });
                }}
              />
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => search?.openSearch()}
            aria-label={search?.open ? "Focus calendar search" : "Open calendar search"}
            aria-pressed={search?.open ? "true" : "false"}
            data-testid="calendar-search-header-button"
            onMouseEnter={(event) => handleHeaderButtonHover(event, true)}
            onMouseLeave={(event) => resetHeaderButtonHover(event, !!search?.open)}
            data-calendar-focus-ring="true"
            style={{
              ...headerButtonBaseStyle(),
              background: search?.open ? "color-mix(in srgb, var(--sp-accent) 12%, transparent)" : "rgba(255,255,255,0.03)",
              borderColor: search?.open ? "color-mix(in srgb, var(--sp-accent) 28%, transparent)" : "rgba(255,255,255,0.06)",
              color: search?.open ? "var(--sp-accent)" : "rgba(205,214,244,0.7)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Search size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
