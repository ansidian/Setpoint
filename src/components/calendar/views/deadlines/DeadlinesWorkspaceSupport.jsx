/* eslint-disable react-refresh/only-export-components */
import { Check, Circle, CircleDashed, ExternalLink, Flag, ListChecks, Pencil } from "lucide-react";
import {
  EmptyDayCard,
  getOverviewModel,
  MetricCard,
  NearbyActivityCard,
  OverviewHero,
  SpotlightCard,
} from "../../CalendarRailStates.jsx";
import {
  RailAction,
  RailFactTile,
  RailHeroCard,
  RailMetaChip,
} from "../../DetailRailPrimitives.jsx";
import { daysUntil } from "../../../../lib/bill-utils";
import { daysLabel, urgencyForDays } from "../../../../lib/redesign-helpers";
import {
  PRIORITY_META,
  SOURCE_COLORS,
  normalizeStatus,
  openInNewTab,
  sourceLabelFor,
  sourceOf,
  statusLabel,
} from "./deadlinesModel.js";
import { useDashboard } from "../../../../context/DashboardContext.jsx";
import {
  CompactBandAction,
  compactPanelStyle,
  compactEyebrowStyle,
  compactValueStyle,
  compactDetailStyle,
  compactMetricRowStyle,
  nearestBusyDay,
} from "../compactBandPrimitives.jsx";

function formatShortDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatFullDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function bandGridStyle(layout, wide = false) {
  if (layout.tier === "md") {
    return {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 8,
      minHeight: "100%",
    };
  }

  return {
    display: "grid",
    gridTemplateColumns: wide ? "minmax(0, 1fr)" : "minmax(0, 1.18fr) minmax(208px, 0.82fr) minmax(184px, 0.82fr)",
    gap: 8,
    minHeight: "100%",
  };
}

function panelStyle() {
  return {
    padding: "8px 10px",
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
    gap: 8,
    minHeight: 0,
  };
}

function deadlineTitle(task) {
  return task?.title || task?.name || "Untitled task";
}

function deadlineContext(task) {
  return task?.class_name || task?.project_name || null;
}

function sourceMix(data) {
  const all = [
    ...(data?.ctm?.upcoming || []),
    ...(data?.todoist?.upcoming || []),
  ];
  return all.reduce((acc, item) => {
    const source = sourceOf(item);
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
}

function DeadlineSupportCard({ task, accent, onStartEdit, compact = false }) {
  const { handleCompleteTask, handleUpdateTaskStatus } = useDashboard();
  const source = sourceOf(task);
  const isTodoist = source === "todoist";
  const sourceColor = SOURCE_COLORS[source] || accent;
  const ctmUrl = `https://ctm.andysu.tech/#/event/${task?.id}`;
  const dueDays = daysUntil(task?.due_date);
  const urgency = urgencyForDays(dueDays, accent);
  const dueColor = task?.due_date ? (urgency.key === "high" ? "#f38ba8" : urgency.key === "medium" ? "#f9e2af" : accent) : "rgba(205,214,244,0.7)";
  const normalizedStatus = normalizeStatus(task?.status);
  const priorityMeta = PRIORITY_META[task?.priority];

  return (
    <div data-testid="calendar-selected-deadline-card">
      <RailHeroCard accent={accent} compact={compact}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: sourceColor,
                boxShadow: `0 0 0 1px ${sourceColor}22, 0 0 8px ${sourceColor}2b`,
              }}
            />
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: sourceColor }}>
              {sourceLabelFor(task)}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {priorityMeta ? (
              <RailMetaChip tone="accent" color={priorityMeta.color} compact={compact}>
                <Flag size={10} strokeWidth={2.2} />
                {priorityMeta.label}
              </RailMetaChip>
            ) : null}
            <RailMetaChip tone="quiet" compact={compact}>{statusLabel(normalizedStatus)}</RailMetaChip>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
          <div
            data-testid="calendar-selected-deadline-title"
            style={{
              fontSize: compact ? 20 : 24,
              lineHeight: 1.06,
              letterSpacing: compact ? -0.34 : -0.44,
              color: "#fff",
              fontWeight: 500,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {deadlineTitle(task)}
          </div>
          <div style={{ ...clampStyle(2), fontSize: compact ? 11 : 12.5, lineHeight: 1.35, color: "rgba(205,214,244,0.58)" }}>
            {deadlineContext(task) || "Task context unavailable"}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: compact ? 6 : 8 }}>
          <RailFactTile
            label="Due"
            value={task?.due_date ? `${daysLabel(dueDays)} · ${task.due_time || "End of day"}` : "No due date"}
            color={dueColor}
            compact={compact}
          />
          <RailFactTile
            label="Source"
            value={sourceLabelFor(task)}
            color={sourceColor}
            compact={compact}
          />
        </div>

        <div
          style={{
            marginTop: "auto",
            paddingTop: compact ? 8 : 10,
            borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: compact ? 8 : 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {isTodoist ? (
              <>
                {normalizedStatus !== "complete" ? (
                  <RailAction
                    icon={Check}
                    label="Mark complete"
                    accent={accent}
                    tone="success"
                    size={compact ? "compact" : "default"}
                    onClick={() => handleCompleteTask(task.id)}
                  />
                ) : null}
                <RailAction
                  icon={Pencil}
                  label="Edit"
                  accent={accent}
                  size={compact ? "compact" : "default"}
                  onClick={() => onStartEdit?.(task)}
                />
              </>
            ) : (
              <>
                {normalizedStatus !== "complete" ? (
                  <RailAction
                    icon={Check}
                    label="Mark complete"
                    accent={accent}
                    tone="success"
                    size={compact ? "compact" : "default"}
                    onClick={() => handleUpdateTaskStatus(task.id, "complete")}
                  />
                ) : null}
                {normalizedStatus !== "in_progress" ? (
                  <RailAction
                    icon={CircleDashed}
                    label="In progress"
                    accent={accent}
                    size={compact ? "compact" : "default"}
                    onClick={() => handleUpdateTaskStatus(task.id, "in_progress")}
                  />
                ) : null}
                {normalizedStatus !== "incomplete" ? (
                  <RailAction
                    icon={Circle}
                    label="Reopen"
                    accent={accent}
                    size={compact ? "compact" : "default"}
                    onClick={() => handleUpdateTaskStatus(task.id, "incomplete")}
                  />
                ) : null}
              </>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {isTodoist ? (
              task?.url ? (
                <RailAction
                  icon={ExternalLink}
                  label="Open in Todoist"
                  accent={accent}
                  tone="ghost"
                  size={compact ? "compact" : "default"}
                  onClick={() => openInNewTab(task.url)}
                />
              ) : null
            ) : (
              <>
                {task?.url && /instructure\.com|canvas/i.test(task.url) ? (
                  <RailAction
                    icon={ExternalLink}
                    label="Open in Canvas"
                    accent={accent}
                    tone="ghost"
                    size={compact ? "compact" : "default"}
                    onClick={() => openInNewTab(task.url)}
                  />
                ) : null}
                <RailAction
                  icon={ExternalLink}
                  label="Open in CTM"
                  accent={accent}
                  tone="ghost"
                  size={compact ? "compact" : "default"}
                  onClick={() => openInNewTab(ctmUrl)}
                />
              </>
            )}
          </div>
        </div>
      </RailHeroCard>
    </div>
  );
}

function OverviewSupport({ layout, model, data }) {
  const compactBand = !layout.stacked;
  const mix = sourceMix(data);
  const mixEntries = [
    ["Canvas", mix.canvas || 0],
    ["Todoist", mix.todoist || 0],
    ["CTM", mix.manual || 0],
  ];

  if (compactBand) {
    return (
      <div style={bandGridStyle(layout)}>
        <div style={compactPanelStyle(model.accent, true)}>
          <div style={compactEyebrowStyle()}>{model.eyebrow}</div>
          <div style={compactValueStyle("#f5f7ff", 18)}>
            {model.title}
          </div>
          <div style={compactDetailStyle()}>
            {mixEntries.map(([label, count]) => `${label} ${count}`).join(" · ")}
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>{model.spotlight.label}</div>
          <div style={compactValueStyle("#fff", 18)}>
            {model.spotlight.value}
          </div>
          <div style={compactDetailStyle()}>
            {model.spotlight.detail}
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
        <div style={{ ...panelStyle(), display: "flex", alignItems: "center", gap: 10 }}>
          <ListChecks size={16} color="var(--ea-accent)" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
              Source mix
            </div>
            <div style={{ ...clampStyle(2), marginTop: 4, fontSize: 11, lineHeight: 1.45, color: "rgba(205,214,244,0.58)" }}>
              {mixEntries.map(([label, count]) => `${label} ${count}`).join(" · ")}
            </div>
          </div>
        </div>
      </div>

      <div style={stackStyle()}>
        <SpotlightCard
          accent={model.accent}
          label={model.spotlight.label}
          value={model.spotlight.value}
          detail={model.spotlight.detail}
          compact={compactBand}
        />
        <div style={{ ...panelStyle(), display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {mixEntries.map(([label, count]) => (
            <RailFactTile key={label} label={label} value={`${count}`} color="var(--ea-accent)" compact={compactBand} />
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateRows: "repeat(2, minmax(0, 1fr))", gap: compactBand ? 8 : 12 }}>
        {model.stats.map((stat) => (
          <MetricCard key={stat.label} {...stat} accent={model.accent} compact={compactBand} />
        ))}
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
            {nearestBusy ? nearestBusy.label : "No nearby tasks"}
          </div>
          <div style={compactDetailStyle()}>
            {nearestBusy
              ? `${nearestBusy.count} task${nearestBusy.count === 1 ? "" : "s"} sitting ${nearestBusy.direction} on the grid.`
              : "Use arrows, click any day, or press C to create something new."}
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Create from here</div>
          <div style={compactValueStyle(model.accent, 18)}>Press C</div>
          <div style={compactDetailStyle()}>
            Seed a new task on this date without leaving the month workspace.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout, true)}>
      <div style={{ display: "grid", gridTemplateColumns: layout.tier === "md" ? "minmax(0, 1fr)" : "minmax(280px, 1.02fr) minmax(0, 0.98fr)", gap: compactBand ? 8 : 12 }}>
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
            <div style={{ ...panelStyle(), fontSize: 11.5, lineHeight: 1.5, color: "rgba(205,214,244,0.58)" }}>
            Press `C` to seed a new task while keeping the month grid visible and the right stage ready for list navigation.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailSupport({ layout, task, selectedDayState, selectedDay, viewYear, viewMonth, onStartEdit, accent }) {
  const { handleCompleteTask, handleUpdateTaskStatus } = useDashboard();
  const compactBand = !layout.stacked;
  const dueDays = daysUntil(task?.due_date);
  const normalizedStatus = normalizeStatus(task?.status);
  const source = sourceOf(task);
  const isTodoist = source === "todoist";
  const ctmUrl = `https://ctm.andysu.tech/#/event/${task?.id}`;

  if (compactBand) {
    return (
      <div style={bandGridStyle(layout)}>
        <div data-testid="calendar-selected-deadline-card" style={compactPanelStyle(accent, true)}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={compactEyebrowStyle()}>{sourceLabelFor(task)}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {isTodoist ? (
                <>
                  {normalizedStatus !== "complete" ? (
                    <CompactBandAction label="Complete" color="#a6e3a1" tone="success" onClick={() => handleCompleteTask(task.id)} />
                  ) : null}
                  <CompactBandAction label="Edit" color="#cba6da" onClick={() => onStartEdit?.(task)} />
                  {task?.url ? <CompactBandAction label="Todoist" color="rgba(205,214,244,0.62)" onClick={() => openInNewTab(task.url)} /> : null}
                </>
              ) : (
                <>
                  {normalizedStatus !== "complete" ? (
                    <CompactBandAction label="Complete" color="#a6e3a1" tone="success" onClick={() => handleUpdateTaskStatus(task.id, "complete")} />
                  ) : null}
                  {normalizedStatus !== "in_progress" ? (
                    <CompactBandAction label="In progress" color="#cba6da" onClick={() => handleUpdateTaskStatus(task.id, "in_progress")} />
                  ) : null}
                  {normalizedStatus !== "incomplete" ? (
                    <CompactBandAction label="Reopen" color="#cba6da" onClick={() => handleUpdateTaskStatus(task.id, "incomplete")} />
                  ) : null}
                  {task?.url && /instructure\.com|canvas/i.test(task.url) ? (
                    <CompactBandAction label="Canvas" color="rgba(205,214,244,0.62)" onClick={() => openInNewTab(task.url)} />
                  ) : null}
                  <CompactBandAction label="CTM" color="rgba(205,214,244,0.62)" onClick={() => openInNewTab(ctmUrl)} />
                </>
              )}
            </div>
          </div>
          <div
            data-testid="calendar-selected-deadline-title"
            title={deadlineTitle(task)}
            style={{
              ...compactValueStyle("#fff", 18),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {deadlineTitle(task)}
          </div>
          <div style={compactDetailStyle()}>
            {task?.due_date ? `${daysLabel(dueDays)} · ${task.due_time || "End of day"}` : "No due date"}
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Selected day</div>
          <div style={compactValueStyle(accent, 18)}>
            {formatShortDate(viewYear, viewMonth, selectedDay)}
          </div>
          <div style={compactDetailStyle()}>
            {selectedDayState?.totalCount || 0} deadline{selectedDayState?.totalCount === 1 ? "" : "s"} on this date
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Status</div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Open</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: accent, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{selectedDayState?.activeCount || 0}</span>
          </div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Complete</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: accent, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{selectedDayState?.completedCount || 0}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout)}>
      <DeadlineSupportCard task={task} accent={accent} onStartEdit={onStartEdit} compact={compactBand} />
      <div style={stackStyle()}>
        <MetricCard
          label="Selected day"
          value={formatShortDate(viewYear, viewMonth, selectedDay)}
          detail={`${selectedDayState?.totalCount || 0} deadline${selectedDayState?.totalCount === 1 ? "" : "s"} on this date`}
          accent={accent}
          compact={compactBand}
        />
        <MetricCard
          label="Open"
          value={`${selectedDayState?.activeCount || 0}`}
          detail={selectedDayState?.activeCount ? "Still needs attention" : "Everything here is complete"}
          accent={accent}
          compact={compactBand}
        />
      </div>
      <div style={stackStyle()}>
        <MetricCard
          label="Complete"
          value={`${selectedDayState?.completedCount || 0}`}
          detail={selectedDayState?.completedCount ? "Already cleared on this day" : "Nothing complete yet"}
          accent={accent}
          compact={compactBand}
        />
        <div style={{ ...panelStyle(), display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: compactBand ? 6 : 8 }}>
          <RailFactTile label="Status" value={statusLabel(task?.status)} color={accent} compact={compactBand} />
          <RailFactTile label="Context" value={deadlineContext(task) || "No context"} compact={compactBand} />
        </div>
      </div>
    </div>
  );
}

function DaySupport({ layout, selectedDayState, selectedDay, viewYear, viewMonth, accent }) {
  const compactBand = !layout.stacked;
  const allItems = [...(selectedDayState?.activeItems || []), ...(selectedDayState?.completedItems || [])];
  const previewItems = allItems.slice(0, compactBand ? 2 : 3);
  const extraCount = Math.max(0, allItems.length - previewItems.length);
  const nextTask = allItems[0] || null;

  if (compactBand) {
    return (
      <div style={bandGridStyle(layout)}>
        <div style={compactPanelStyle(accent, true)}>
          <div style={compactEyebrowStyle()}>Selected day</div>
          <div style={compactValueStyle(accent, 18)}>
            {formatShortDate(viewYear, viewMonth, selectedDay)}
          </div>
          <div style={compactDetailStyle()}>
            {selectedDayState?.totalCount || 0} deadline{selectedDayState?.totalCount === 1 ? "" : "s"} on this date
          </div>
        </div>

        <div style={compactPanelStyle()}>
          <div style={compactEyebrowStyle()}>Breakdown</div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Open</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: accent, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{selectedDayState?.activeCount || 0}</span>
          </div>
          <div style={compactMetricRowStyle()}>
            <span style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.62)" }}>Complete</span>
            <span style={{ fontSize: 16, lineHeight: 1, color: accent, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{selectedDayState?.completedCount || 0}</span>
          </div>
        </div>

        <div style={{ ...compactPanelStyle(), gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={compactEyebrowStyle()}>On the grid</div>
            {extraCount > 0 ? <RailMetaChip tone="quiet" compact>+{extraCount} more</RailMetaChip> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {previewItems.map((task) => {
              const source = sourceOf(task);
              const sourceColor = SOURCE_COLORS[source] || accent;
              return (
                <div key={task.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: sourceColor, whiteSpace: "nowrap" }}>
                    {task.due_time || sourceLabelFor(task)}
                  </span>
                  <span style={{ minWidth: 0, fontSize: 11, lineHeight: 1.35, color: normalizeStatus(task.status) === "complete" ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: normalizeStatus(task.status) === "complete" ? "line-through" : "none", textDecorationColor: "rgba(205,214,244,0.24)" }}>
                    {deadlineTitle(task)}
                  </span>
                </div>
              );
            })}
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
          detail={`${selectedDayState?.totalCount || 0} deadline${selectedDayState?.totalCount === 1 ? "" : "s"} on this date`}
          accent={accent}
          compact={compactBand}
        />
        <div style={{ ...panelStyle(), display: "flex", flexDirection: "column", gap: compactBand ? 6 : 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
            Next due
          </div>
          <div style={{ ...clampStyle(2), fontSize: compactBand ? 11.5 : 12.5, lineHeight: 1.35, color: "#eef2ff" }}>
            {nextTask ? deadlineTitle(nextTask) : "No task selected"}
          </div>
          {!compactBand ? (
            <div style={{ fontSize: 11, lineHeight: 1.45, color: "rgba(205,214,244,0.58)" }}>
            {nextTask?.due_time || nextTask?.due_date || "No due date"}
            </div>
          ) : null}
        </div>
      </div>
      <div style={stackStyle()}>
        <MetricCard
          label="Open"
          value={`${selectedDayState?.activeCount || 0}`}
          detail={selectedDayState?.activeCount ? "Still needs attention" : "Everything here is complete"}
          accent={accent}
          compact={compactBand}
        />
        <MetricCard
          label="Complete"
          value={`${selectedDayState?.completedCount || 0}`}
          detail={selectedDayState?.completedCount ? "Already cleared on this day" : "Nothing complete yet"}
          accent={accent}
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
          {previewItems.map((task) => {
            const source = sourceOf(task);
            const sourceColor = SOURCE_COLORS[source] || accent;
            return (
              <div key={task.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: compactBand ? 10 : 10.5, fontWeight: 600, color: sourceColor, whiteSpace: "nowrap" }}>
                  {task.due_time || sourceLabelFor(task)}
                </span>
                <span style={{ minWidth: 0, fontSize: compactBand ? 11 : 11.5, lineHeight: 1.35, color: normalizeStatus(task.status) === "complete" ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: normalizeStatus(task.status) === "complete" ? "line-through" : "none", textDecorationColor: "rgba(205,214,244,0.24)" }}>
                  {deadlineTitle(task)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EditorSupport({ layout, deadlineEditor, selectedTask, selectedDay, viewYear, viewMonth, accent }) {
  const compactBand = !layout.stacked;
  const title = selectedTask ? deadlineTitle(selectedTask) : deadlineEditor?.mode === "create" ? "New task" : "Edit task";
  const dateLabel = deadlineEditor?.seedDate || (selectedTask?.due_date || (selectedDay ? new Date(viewYear, viewMonth, selectedDay).toLocaleDateString("en-CA") : null));
  const modeLabel = deadlineEditor?.mode === "edit" ? "Editing task" : "New task";

  if (compactBand) {
    return (
      <div style={bandGridStyle(layout, true)}>
        <div style={compactPanelStyle(accent, true)}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={compactEyebrowStyle()}>{modeLabel}</div>
            <RailMetaChip tone="quiet" compact>{dateLabel || "No due date"}</RailMetaChip>
          </div>
          <div style={compactValueStyle("#fff", 18)}>
            {title}
          </div>
          <div style={compactDetailStyle()}>
            {dateLabel || "No due date set"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={bandGridStyle(layout, true)}>
      <RailHeroCard accent={accent} compact>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.52)" }}>
            {modeLabel}
          </div>
          <RailMetaChip tone="quiet" compact>{dateLabel || "No due date"}</RailMetaChip>
        </div>
        <div style={{ fontSize: 20, lineHeight: 1.02, letterSpacing: -0.3, color: "#fff" }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "rgba(205,214,244,0.58)" }}>
          The editor widens on the right while this strip keeps the task context anchored to the selected day on the grid.
        </div>
      </RailHeroCard>
    </div>
  );
}

export function renderDeadlinesWorkspaceSupport(props) {
  const model = getOverviewModel(props);
  const accent = "var(--ea-accent)";
  const allItems = [...(props.selectedDayState?.activeItems || []), ...(props.selectedDayState?.completedItems || [])];
  const selectedTask = allItems.find((task) => String(task.id) === String(props.selectedItemId)) || null;
  const handleSelectDay = (day) => {
    props.setDeadlineEditor?.(null);
    props.setSelectedItemId?.(null);
    props.setSelectedDay?.(day);
  };
  const handleStartEdit = (task) => {
    props.setSelectedItemId?.(String(task.id));
    props.setDeadlineEditor?.({ mode: "edit", taskId: String(task.id) });
  };

  if (props.mode === "editor" && props.deadlineEditor) {
    return (
      <EditorSupport
        layout={props.layout}
        deadlineEditor={props.deadlineEditor}
        selectedTask={selectedTask}
        selectedDay={props.selectedDay}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
        accent={accent}
      />
    );
  }

  if (props.mode === "detail" && selectedTask) {
    return (
      <DetailSupport
        layout={props.layout}
        task={selectedTask}
        selectedDayState={props.selectedDayState}
        selectedDay={props.selectedDay}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
        onStartEdit={handleStartEdit}
        accent={accent}
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
        accent={accent}
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
      data={props.data}
    />
  );
}
