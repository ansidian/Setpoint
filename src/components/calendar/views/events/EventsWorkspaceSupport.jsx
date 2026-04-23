/* eslint-disable react-refresh/only-export-components */
import {
  EmptyDayCard,
  getOverviewModel,
  MetricCard,
  NearbyActivityCard,
  OverviewHero,
  SpotlightCard,
} from "../../CalendarRailStates.jsx";
import { RailMetaChip } from "../../DetailRailPrimitives.jsx";
import { getLocationDisplayLabel } from "../../../../lib/calendar-links";
import { formatRecurrenceSummary } from "../../events/calendarEditorUtils.js";
import {
  compactPanelStyle,
  compactEyebrowStyle,
  compactValueStyle,
  compactDetailStyle,
  compactMetricRowStyle,
  nearestBusyDay,
} from "../compactBandPrimitives.jsx";

const MEETING_PROVIDER_PREFIX = /^\s*(?:\(|\[)?\s*(?:zoom|google meet|meet|teams|webex)(?:\)|\])?\s*[:-]?\s*/i;

function bandGridStyle(layout, wide = false) {
  if (layout.tier === "md") {
    return {
      display: "grid",
      gridTemplateColumns: wide ? "minmax(0, 1fr)" : "minmax(0, 1.08fr) minmax(0, 0.92fr)",
      gap: 6,
      minHeight: "100%",
      alignItems: "stretch",
    };
  }

  return {
    display: "grid",
    gridTemplateColumns: wide
      ? "minmax(0, 1fr)"
      : "minmax(0, 1.25fr) minmax(184px, 0.8fr) minmax(184px, 0.8fr)",
    gap: 6,
    minHeight: "100%",
    alignItems: "stretch",
  };
}

function panelStyle() {
  return {
    padding: "6px 8px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.05)",
    background: "rgba(255,255,255,0.018)",
    minWidth: 0,
  };
}

function clampStyle(lines = 2) {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}

function stackStyle() {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minHeight: 0,
  };
}

function sanitizeEventDisplayTitle(value) {
  const title = String(value || "").trim();
  if (!title) return "(No title)";
  const cleaned = title.replace(MEETING_PROVIDER_PREFIX, "").trim();
  return cleaned || title;
}

function orderEvents(items = []) {
  return [...items].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startMs || 0) - (b.startMs || 0);
  });
}

function pacificTime(ms) {
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function eventTimeRange(ev) {
  if (ev?.allDay) return ev.duration || "All day";
  const start = ev?.startMs ? pacificTime(ev.startMs) : null;
  const end = ev?.endMs ? pacificTime(ev.endMs) : null;
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end || "No time";
}

function formatFullDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatShortDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatEditorSupportDate(value) {
  if (!value) return null;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatEditorSupportTime(value) {
  if (!value) return null;
  return new Date(`2000-01-01T${value}:00`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function findNextBusyWindow(itemsByDay, currentDay, viewYear, viewMonth) {
  const days = Object.keys(itemsByDay || {})
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const nextDay = days.find((day) => day >= currentDay) ?? days[0];
  if (!nextDay) return null;
  const count = Array.isArray(itemsByDay?.[nextDay]) ? itemsByDay[nextDay].length : itemsByDay?.[nextDay]?.totalCount || 0;
  return {
    label: new Date(viewYear, viewMonth, nextDay).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    detail: `${count} event${count === 1 ? "" : "s"}`,
  };
}

function resolveSelectedSource(editor) {
  const sourceKey = editor?.draft?.accountId && editor?.draft?.calendarId
    ? `${editor.draft.accountId}::${editor.draft.calendarId}`
    : null;
  if (!sourceKey) return null;

  const source = editor.writableCalendars?.find((entry) => `${entry.accountId}::${entry.id}` === sourceKey);
  return source?.label || source?.summary || null;
}

function formatEditorDateRange(editor) {
  const draft = editor?.draft;
  if (!draft?.startDate) return "Choose a date to place the event on the month grid.";
  const startDateLabel = formatEditorSupportDate(draft.startDate);
  const endDateLabel = formatEditorSupportDate(draft.endDate);
  if (draft.allDay) {
    if (draft.endDate && draft.endDate !== draft.startDate) {
      return `${startDateLabel} to ${endDateLabel} · All day`;
    }
    return `${startDateLabel} · All day`;
  }

  const start = formatEditorSupportTime(draft.startTime) || "Start";
  const end = formatEditorSupportTime(draft.endTime) || "End";
  if (draft.endDate && draft.endDate !== draft.startDate) {
    return `${startDateLabel} ${start} to ${endDateLabel} ${end}`;
  }
  return `${startDateLabel} · ${start} to ${end}`;
}

function editorModeLabel(editor) {
  if (editor?.isEditing) return "Editing event";
  if (editor?.intentState?.mode === "batch") return "Batch draft";
  if (editor?.intentState?.mode === "recurring") return "Recurring draft";
  return "New event";
}

function OverviewSupport({ layout, model, computed, itemsByDay, viewYear, viewMonth, currentYear, currentMonth, todayDate, data }) {
  const compactBand = !layout.stacked;
  const nextBusyWindow = findNextBusyWindow(
    itemsByDay,
    viewYear === currentYear && viewMonth === currentMonth ? todayDate : 1,
    viewYear,
    viewMonth,
  );

  if (compactBand) {
    return (
      <div style={bandGridStyle(layout)}>
        <div style={compactPanelStyle(model.accent, true)}>
          <div style={compactEyebrowStyle()}>{model.eyebrow}</div>
          <div style={compactValueStyle("#f5f7ff", 18)}>
            {model.title}
          </div>
          <div style={compactDetailStyle()}>
            {nextBusyWindow
              ? `${nextBusyWindow.detail} next on ${nextBusyWindow.label}.`
              : "Month is clear. Select a day or press C to place something new."}
          </div>
        </div>

        <div style={compactPanelStyle(model.accent)}>
          <div style={compactEyebrowStyle()}>{data?.isLoading ? "Loading month" : model.spotlight.label}</div>
          <div style={compactValueStyle("#fff", 18)}>
            {data?.isLoading ? "Pulling events" : model.spotlight.value}
          </div>
          <div style={compactDetailStyle()}>
            {data?.isLoading
              ? "Month context stays visible while events load."
              : nextBusyWindow
                ? `Next busy window ${nextBusyWindow.label}.`
                : model.spotlight.detail}
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>At a glance</div>
          {model.stats.map((stat) => (
            <div key={stat.label} style={compactMetricRowStyle()}>
              <span style={{ minWidth: 0, fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>
                {stat.label}
              </span>
              <span style={{ fontSize: 16, lineHeight: 1, color: model.accent, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout)}>
      <div style={stackStyle()}>
        <OverviewHero model={model} compact={compactBand} />
      </div>

      <div style={stackStyle()}>
        {data?.isLoading ? (
          <div style={{ ...panelStyle(), display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
              Loading month
            </div>
            <div style={{ fontSize: compactBand ? 18 : 22, lineHeight: 1.02, letterSpacing: compactBand ? -0.28 : -0.36, color: "#fff" }}>
              Pulling events
            </div>
            <div style={{ ...clampStyle(2), fontSize: 11, lineHeight: 1.45, color: "rgba(205,214,244,0.56)" }}>
              Support band keeps month context visible while events load.
            </div>
          </div>
        ) : (
          <SpotlightCard
            accent={model.accent}
            label={model.spotlight.label}
            value={model.spotlight.value}
            detail={model.spotlight.detail}
            compact={compactBand}
          />
        )}
        <div style={panelStyle()}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
            Next busy window
          </div>
          <div style={{ marginTop: 6, fontSize: compactBand ? 18 : 22, lineHeight: 1.02, letterSpacing: compactBand ? -0.28 : -0.36, color: "#fff" }}>
            {nextBusyWindow ? nextBusyWindow.label : "Month is clear"}
          </div>
          <div style={{ ...clampStyle(2), marginTop: 6, fontSize: 11, lineHeight: 1.45, color: "rgba(205,214,244,0.56)" }}>
            {nextBusyWindow
              ? `${nextBusyWindow.detail} queued next on the grid.`
              : "No events are scheduled yet, so any selected day stays wide open."}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateRows: "repeat(2, minmax(0, 1fr))", gap: compactBand ? 8 : 12 }}>
        {model.stats.map((stat) => (
          <MetricCard key={stat.label} {...stat} accent={model.accent} compact={compactBand} />
        ))}
        <MetricCard
          label="Average load"
          value={Object.keys(itemsByDay || {}).length ? `${Math.round((computed?.totalEvents || 0) / Math.max(Object.keys(itemsByDay || {}).length, 1))}` : "0"}
          detail={Object.keys(itemsByDay || {}).length ? "Events per active day this month" : "No active days yet"}
          accent={model.accent}
          compact={compactBand}
        />
      </div>
    </div>
  );
}

function EmptySupport({ layout, model, itemsByDay, selectedDay, viewYear, viewMonth, activeView, onSelectDay }) {
  const compactBand = !layout.stacked;

  if (compactBand) {
    const nearestBusy = nearestBusyDay(itemsByDay, selectedDay, viewYear, viewMonth);

    return (
      <div style={bandGridStyle(layout)}>
        <div data-testid="calendar-selected-empty-rail" style={compactPanelStyle(model.accent, true)}>
          <div style={compactEyebrowStyle()}>{model.selectedDayLabel}</div>
          <div style={compactValueStyle("#fff", 18)}>
            {formatFullDate(viewYear, viewMonth, selectedDay)}
          </div>
          <div style={compactDetailStyle()}>
            {model.railDescription}
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>{nearestBusy ? "Nearest activity" : "Month is clear"}</div>
          <div style={compactValueStyle("#fff", 18)}>
            {nearestBusy ? nearestBusy.label : "No nearby events"}
          </div>
          <div style={compactDetailStyle()}>
            {nearestBusy
              ? `${nearestBusy.count} event${nearestBusy.count === 1 ? "" : "s"} sitting ${nearestBusy.direction} on the grid.`
              : "Use arrows, click any day, or press C to create something new."}
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Create from here</div>
          <div style={compactValueStyle("#89b4fa", 18)}>Press C</div>
          <div style={compactDetailStyle()}>
            Seed a new event on this date without leaving the month workspace.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout, layout.tier === "md")}>
      <EmptyDayCard model={model} viewYear={viewYear} viewMonth={viewMonth} selectedDay={selectedDay} compact={compactBand} />
      <div style={stackStyle()}>
        <NearbyActivityCard
          model={model}
          activeView={activeView}
          itemsByDay={itemsByDay}
          selectedDay={selectedDay}
          viewYear={viewYear}
          viewMonth={viewMonth}
          onSelectDay={onSelectDay}
          compact={compactBand}
        />
        {!compactBand ? (
          <div style={{ ...panelStyle(), display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
              Create from here
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "rgba(205,214,244,0.62)" }}>
              Press `C` to create an event on this day without leaving the month workspace.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DaySupport({ layout, selectedDayState, selectedDay, viewYear, viewMonth }) {
  const compactBand = !layout.stacked;
  const ordered = orderEvents(selectedDayState?.items || []);
  const timedCount = ordered.filter((item) => !item.allDay).length;
  const allDayCount = ordered.filter((item) => item.allDay).length;
  const firstEvent = ordered[0] || null;
  const lastEvent = ordered[ordered.length - 1] || null;
  const previewItems = ordered.slice(0, compactBand ? 2 : 3);
  const extraCount = Math.max(0, ordered.length - previewItems.length);
  const timeWindow = firstEvent && lastEvent
    ? firstEvent === lastEvent
      ? eventTimeRange(firstEvent)
      : `${eventTimeRange(firstEvent)} → ${eventTimeRange(lastEvent)}`
    : "No events";

  if (compactBand) {
    return (
      <div style={bandGridStyle(layout)}>
        <div style={compactPanelStyle("#89b4fa", true)}>
          <div style={compactEyebrowStyle()}>Selected day</div>
          <div style={compactValueStyle("#89b4fa", 18)}>
            {formatShortDate(viewYear, viewMonth, selectedDay)}
          </div>
          <div style={compactDetailStyle()}>
            {ordered.length} event{ordered.length === 1 ? "" : "s"} · {timeWindow}
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Schedule</div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Timed</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: "#89b4fa", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{timedCount}</span>
          </div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>All-day</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: "#89b4fa", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{allDayCount}</span>
          </div>
        </div>

        <div style={{ ...compactPanelStyle(), gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={compactEyebrowStyle()}>On the grid</div>
            {extraCount > 0 ? <RailMetaChip tone="quiet" compact>+{extraCount} more</RailMetaChip> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {previewItems.map((item) => (
              <div key={String(item.id || item.iCalUID || item.htmlLink || item.openUrl)} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: item.color || "#89b4fa", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {item.allDay ? "All day" : eventTimeRange(item)}
                </span>
                <span style={{ minWidth: 0, fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sanitizeEventDisplayTitle(item.title)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout)}>
      <div style={stackStyle()}>
        <MetricCard
          label="Selected day"
          value={formatShortDate(viewYear, viewMonth, selectedDay)}
          detail={`${ordered.length} event${ordered.length === 1 ? "" : "s"} on this day`}
          accent="#89b4fa"
          compact={compactBand}
        />
        <div style={{ ...panelStyle(), display: "flex", flexDirection: "column", gap: compactBand ? 6 : 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
            Day window
          </div>
          <div style={{ fontSize: compactBand ? 11.5 : 12.5, lineHeight: 1.35, color: "#eef2ff" }}>
            {timeWindow}
          </div>
          {firstEvent && !compactBand ? (
            <div style={{ fontSize: 11, lineHeight: 1.45, color: "rgba(205,214,244,0.58)" }}>
              Starts with {sanitizeEventDisplayTitle(firstEvent.title)}
            </div>
          ) : null}
        </div>
      </div>
      <div style={stackStyle()}>
        <MetricCard
          label="Timed"
          value={`${timedCount}`}
          detail={timedCount ? "Time-bound events on this date" : "No timed events"}
          accent="#89b4fa"
          compact={compactBand}
        />
        <MetricCard
          label="All-day"
          value={`${allDayCount}`}
          detail={allDayCount ? "Longer holds already on the grid" : "No all-day holds"}
          accent="#89b4fa"
          compact={compactBand}
        />
      </div>
      <div style={{ ...panelStyle(), display: "flex", flexDirection: "column", gap: compactBand ? 6 : 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
            On the grid
          </div>
          {extraCount > 0 ? <RailMetaChip tone="quiet" compact={compactBand}>+{extraCount} more</RailMetaChip> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: compactBand ? 4 : 6 }}>
          {previewItems.map((item) => (
            <div key={String(item.id || item.iCalUID || item.htmlLink || item.openUrl)} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: compactBand ? 10 : 10.5, fontWeight: 600, color: item.color || "#89b4fa", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {item.allDay ? "All day" : eventTimeRange(item)}
              </span>
              <span style={{ minWidth: 0, fontSize: compactBand ? 11 : 11.5, lineHeight: 1.35, color: "rgba(205,214,244,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {sanitizeEventDisplayTitle(item.title)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function editorSummaryPanelStyle(emphasis = false, compact = false) {
  return {
    ...panelStyle(),
    padding: emphasis ? (compact ? "7px 9px" : "8px 10px") : (compact ? "5px 7px" : "6px 8px"),
    background: emphasis
      ? "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.018))"
      : "rgba(255,255,255,0.018)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    justifyContent: emphasis ? "space-between" : "flex-start",
    minWidth: 0,
  };
}

function editorSummaryGridStyle(layout, panelCount, compact = false) {
  if (layout.tier === "md") {
    if (panelCount <= 1) {
      return {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: compact ? 8 : 10,
        alignItems: "stretch",
      };
    }

      return {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.18fr) minmax(0, 0.82fr)",
        gap: compact ? 8 : 10,
        alignItems: "stretch",
      };
    }

  if (panelCount <= 1) {
      return {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: compact ? 8 : 10,
        alignItems: "stretch",
      };
    }

  if (panelCount === 2) {
      return {
        display: "grid",
        gridTemplateColumns: compact ? "minmax(0, 1.4fr) minmax(190px, 0.82fr)" : "minmax(0, 1.5fr) minmax(220px, 0.82fr)",
        gap: compact ? 8 : 10,
        alignItems: "stretch",
      };
    }

  return {
    display: "grid",
    gridTemplateColumns: compact ? "minmax(0, 1.35fr) repeat(2, minmax(168px, 0.76fr))" : "minmax(0, 1.45fr) repeat(2, minmax(180px, 0.76fr))",
    gap: compact ? 8 : 10,
    alignItems: "stretch",
  };
}

function formatDurationLabel(draft) {
  if (!draft?.startDate) return null;

  if (draft.allDay) {
    const start = new Date(`${draft.startDate}T12:00:00Z`);
    const end = new Date(`${(draft.endDate || draft.startDate)}T12:00:00Z`);
    const spanDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
    return spanDays === 1 ? "All day" : `${spanDays}-day span`;
  }

  if (!draft.startTime || !draft.endTime) return null;
  const start = new Date(`${draft.startDate}T${draft.startTime}:00`);
  const end = new Date(`${draft.endDate || draft.startDate}T${draft.endTime}:00`);
  const diffMinutes = Math.max(0, Math.round((end - start) / 60000));

  if (diffMinutes < 60) return `${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (!minutes) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function formatRecurrenceEndsLabel(recurrenceDraft) {
  const ends = recurrenceDraft?.ends;
  if (!ends?.type || ends.type === "never") return "No end date";
  if (ends.type === "onDate") {
    return ends.untilDate ? `Until ${formatEditorSupportDate(ends.untilDate)}` : "Until chosen date";
  }
  if (ends.type === "afterCount") {
    const count = Number(ends.count) || 1;
    return `${count} occurrence${count === 1 ? "" : "s"}`;
  }
  return null;
}

function buildBatchOverview(batchDrafts = [], allDay = false) {
  const ordered = [...batchDrafts].sort((a, b) => {
    const left = `${a.startDate || ""}-${a.startTime || ""}`;
    const right = `${b.startDate || ""}-${b.startTime || ""}`;
    return left.localeCompare(right);
  });

  if (!ordered.length) return null;

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const dates = ordered.map((item) => formatEditorSupportDate(item.startDate)).filter(Boolean);
  const sameWindow = ordered.every((item) =>
    item.startTime === first.startTime
      && item.endTime === first.endTime
      && item.endDate === first.endDate
      && item.allDay === first.allDay,
  );

  return {
    countLabel: `${ordered.length} event${ordered.length === 1 ? "" : "s"}`,
    spanLabel: first.startDate === last.startDate
      ? formatEditorSupportDate(first.startDate)
      : `${formatEditorSupportDate(first.startDate)} to ${formatEditorSupportDate(last.startDate)}`,
    dates: dates.slice(0, 4),
    remainingDates: Math.max(0, dates.length - 4),
    timeLabel: allDay
      ? "All day"
      : sameWindow
        ? `${formatEditorSupportTime(first.startTime)} - ${formatEditorSupportTime(first.endTime)}`
        : "Mixed time windows",
    durationLabel: formatDurationLabel(first),
  };
}

function CompactInfoPanel({ label, value, detail, children, emphasis = false, compact = false }) {
  return (
    <div style={editorSummaryPanelStyle(emphasis, compact)}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.48)" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: emphasis ? (compact ? 18 : 20) : compact ? 14 : 16,
          lineHeight: emphasis ? 1.02 : 1.15,
          letterSpacing: emphasis ? -0.3 : -0.16,
          color: "#fff",
          fontWeight: emphasis ? 500 : 600,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
      {detail ? (
        <div style={{ ...clampStyle(2), fontSize: compact ? 10.5 : 11.5, lineHeight: 1.45, color: "rgba(205,214,244,0.62)" }}>
          {detail}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function EditorSupport({ layout, editor, selectedDay, viewYear, viewMonth }) {
  const compactBand = !layout.stacked;
  const sourceLabel = resolveSelectedSource(editor);
  const draft = editor?.draft || {};
  const recurrenceSummary = editor?.recurrenceDraft
    ? formatRecurrenceSummary(editor.recurrenceDraft, draft.startDate)
    : "";
  const durationLabel = formatDurationLabel(draft);
  const supportTitle = draft.title?.trim()
    || (selectedDay ? formatFullDate(viewYear, viewMonth, selectedDay) : "Compose inside the workspace");
  const isBatchMode = editor?.intentState?.mode === "batch";
  const isRecurringMode = !!recurrenceSummary;
  const batchOverview = isBatchMode ? buildBatchOverview(editor?.batchDrafts, draft.allDay) : null;
  const recurrenceEnds = isRecurringMode ? formatRecurrenceEndsLabel(editor?.recurrenceDraft) : null;
  const supportPanels = [];

  if (isBatchMode && batchOverview) {
    supportPanels.push(
      <CompactInfoPanel
        key="occurrences"
        label="Occurrences"
        value={batchOverview.countLabel}
        detail={batchOverview.spanLabel}
        compact={compactBand}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {batchOverview.dates.map((label) => (
            <RailMetaChip key={label} tone="quiet" compact={compactBand}>{label}</RailMetaChip>
          ))}
          {batchOverview.remainingDates ? (
            <RailMetaChip tone="quiet" compact={compactBand}>+{batchOverview.remainingDates} more</RailMetaChip>
          ) : null}
        </div>
      </CompactInfoPanel>,
    );
    supportPanels.push(
      <CompactInfoPanel
        key="window"
        label="Time Window"
        value={batchOverview.timeLabel}
        detail={batchOverview.durationLabel}
        compact={compactBand}
      />,
    );
  } else if (isRecurringMode) {
    supportPanels.push(
      <CompactInfoPanel
        key="repeats"
        label="Repeats"
        value={recurrenceSummary}
        detail={recurrenceEnds}
        compact={compactBand}
      />,
    );

    if (durationLabel) {
      supportPanels.push(
        <CompactInfoPanel
          key="duration"
          label="Duration"
          value={durationLabel}
          detail={draft.location ? getLocationDisplayLabel(draft.location) : null}
          compact={compactBand}
        />,
      );
    }
  } else {
    if (durationLabel) {
      const durationDetail = draft.allDay
        ? formatEditorSupportDate(draft.startDate)
        : draft.startTime && draft.endTime
          ? `${formatEditorSupportTime(draft.startTime)} – ${formatEditorSupportTime(draft.endTime)}`
          : formatEditorSupportDate(draft.startDate);
      supportPanels.push(
        <CompactInfoPanel
          key="duration"
          label="Duration"
          value={durationLabel}
          detail={durationDetail}
          compact={compactBand}
        />,
      );
    }

    if (draft.location?.trim()) {
      const resolvedLocation = draft.location.includes(",")
        ? getLocationDisplayLabel(draft.location)
        : "Location draft";
      supportPanels.push(
        <CompactInfoPanel
          key="location"
          label="Location"
          value={resolvedLocation}
          detail={resolvedLocation === "Location draft" ? "Select a place or keep it custom" : null}
          compact={compactBand}
        />,
      );
    } else if (draft.description?.trim()) {
      supportPanels.push(
        <CompactInfoPanel
          key="notes"
          label="Notes"
          value={draft.description.trim().slice(0, 54)}
          detail={draft.description.trim().length > 54 ? "Continues in the editor" : null}
          compact={compactBand}
        />,
      );
    }
  }

  const visibleSupportPanels = compactBand ? supportPanels.slice(0, 2) : supportPanels;

  return (
    <div style={editorSummaryGridStyle(layout, visibleSupportPanels.length + 1, compactBand)}>
      <CompactInfoPanel
        label={editorModeLabel(editor)}
        value={supportTitle}
        detail={formatEditorDateRange(editor)}
        emphasis
        compact={compactBand}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <RailMetaChip tone="quiet" compact={compactBand}>{draft.allDay ? "All day" : "Timed"}</RailMetaChip>
          {sourceLabel ? <RailMetaChip tone="quiet" compact={compactBand}>{sourceLabel}</RailMetaChip> : null}
        </div>
      </CompactInfoPanel>

      {visibleSupportPanels}
    </div>
  );
}

export function renderEventsWorkspaceSupport(props) {
  const model = getOverviewModel(props);
  const handleSelectDay = (day) => {
    props.setDeadlineEditor?.(null);
    props.setSelectedItemId?.(null);
    props.setSelectedDay?.(day);
  };

  if (props.mode === "editor") {
    return (
      <EditorSupport
        layout={props.layout}
        editor={props.eventEditor}
        selectedDay={props.selectedDay}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
      />
    );
  }

  if (props.mode === "detail") {
    return (
      <DaySupport
        layout={props.layout}
        selectedDayState={props.selectedDayState}
        selectedDay={props.selectedDay}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
      />
    );
  }

  if (props.mode === "empty") {
    return (
      <EmptySupport
        layout={props.layout}
        model={model}
        itemsByDay={props.itemsByDay}
        selectedDay={props.selectedDay}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
        activeView={props.activeView}
        onSelectDay={handleSelectDay}
      />
    );
  }

  return (
    <OverviewSupport
      layout={props.layout}
      model={model}
      computed={props.computed}
      itemsByDay={props.itemsByDay}
      viewYear={props.viewYear}
      viewMonth={props.viewMonth}
      currentYear={props.currentYear}
      currentMonth={props.currentMonth}
      todayDate={props.todayDate}
      data={props.data}
    />
  );
}
