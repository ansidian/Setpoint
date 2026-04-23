/* eslint-disable react-refresh/only-export-components */
import { ListChecks } from "lucide-react";
import {
  EmptyDayCard,
  getOverviewModel,
  MetricCard,
  NearbyActivityCard,
  OverviewHero,
  SpotlightCard,
} from "../../CalendarRailStates.jsx";
import {
  RailFactTile,
  RailHeroCard,
  RailMetaChip,
} from "../../DetailRailPrimitives.jsx";
import {
  SOURCE_COLORS,
  normalizeStatus,
  sourceLabelFor,
  sourceOf,
} from "./deadlinesModel.js";
import {
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
