import { forwardRef, useMemo } from "react";
import { parseYmd, ymdFromParts } from "../../calendarDateUtils.js";
import AgendaRailShell from "../agenda/AgendaRailShell.jsx";
import { DeadlineStatusIcon } from "./DeadlineStatusIndicator.jsx";
import { buildDeadlinesAgendaGroups } from "./deadlinesAgendaModel.js";

function groupDate(group) {
  const parsed = parseYmd(group.dateKey);
  return parsed ? new Date(parsed.year, parsed.month, parsed.day) : null;
}

function AgendaHeader({ group, todayKey, onActivate, registerHeader }) {
  const date = groupDate(group);
  return (
    <button
      type="button"
      ref={(node) => registerHeader(group.dateKey, node)}
      data-agenda-date-header="true"
      data-date-key={group.dateKey}
      aria-label={`Select ${date ? date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : group.dateKey}`}
      onClick={() => onActivate(group.dateKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(group.dateKey);
        }
      }}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 4,
        width: "calc(100% + 20px)",
        margin: "0 -10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        minHeight: 34,
        padding: "8px 10px 7px",
        border: "0",
        borderRadius: 0,
        background: "#1f1f24",
        color: group.dateKey === todayKey ? "#0495FF" : "#B1B1B3",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 1.35,
        lineHeight: 1,
        textAlign: "left",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "background-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "#23232a";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "#1f1f24";
      }}
    >
      <span>{group.headerLabel}</span>
    </button>
  );
}

function DeadlineRow({ task, selected, onSelect, quickActions }) {
  const color = task.agendaSelectedColor;
  return (
    <button
      type="button"
      data-testid="calendar-agenda-deadline-row"
      data-agenda-key={task.agendaKey}
      data-item-id={task.agendaItemId}
      onClick={(event) => onSelect(task, event.currentTarget)}
      onContextMenu={(event) => {
        if (!quickActions?.openContextMenu?.({
          task,
          x: event.clientX,
          y: event.clientY,
          anchorElement: event.currentTarget,
          sourceCellElement: event.currentTarget,
          dateKey: task.agendaDateKey,
          anchorKind: "agenda-row",
        })) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "8px minmax(0, 1fr) auto",
        alignItems: "start",
        columnGap: 8,
        rowGap: 4,
        padding: "8px 9px",
        borderRadius: 8,
        border: selected ? `1px solid color-mix(in srgb, ${color} 72%, rgba(255,255,255,0.08))` : "1px solid rgba(255,255,255,0.055)",
        background: selected ? `color-mix(in srgb, ${color} 18%, transparent)` : "rgba(255,255,255,0.025)",
        color: task.agendaComplete ? "rgba(205,214,244,0.58)" : "#cdd6f4",
        cursor: "pointer",
        textAlign: "left",
        transition: "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = "translateY(-1px)";
        if (!selected) event.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
        if (!selected) event.currentTarget.style.borderColor = "rgba(255,255,255,0.055)";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          marginTop: 5,
          gridColumn: 1,
          gridRow: "1 / span 3",
          borderRadius: 999,
          background: task.agendaDotColor,
          boxShadow: selected ? `0 0 0 3px color-mix(in srgb, ${color} 16%, transparent)` : "none",
        }}
      />
      <span style={{ minWidth: 0, gridColumn: 2, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ color: task.agendaComplete ? "rgba(166,173,200,0.54)" : "rgba(166,173,200,0.82)", fontSize: 10, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
          {task.agendaMeta}
        </span>
        <span style={{ color: task.agendaComplete ? "rgba(205,214,244,0.62)" : "#f1f2fb", fontSize: 12, fontWeight: 650, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", textDecoration: task.agendaComplete ? "line-through" : "none", textDecorationColor: "rgba(205,214,244,0.28)" }}>
          {task.agendaTitle}
        </span>
        {task.agendaSubtitle ? (
          <span style={{ color: "rgba(166,173,200,0.64)", fontSize: 10.5, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.agendaSubtitle}
          </span>
        ) : null}
      </span>
      <span style={{ gridColumn: 3, gridRow: "1 / span 3", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 78 }}>
        <DeadlineStatusIcon status={task.status} size={13} />
        <span style={{ color: "rgba(166,173,200,0.62)", fontSize: 9.5, fontWeight: 700, lineHeight: 1.1, textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {task.agendaStatus}
        </span>
      </span>
    </button>
  );
}

function EmptyDeadlineDay({ fallback }) {
  return (
    <div
      style={{
        padding: "12px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.055)",
        background: "rgba(255,255,255,0.025)",
        color: "rgba(205,214,244,0.64)",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 650, color: "rgba(205,214,244,0.82)" }}>
        {fallback ? "No Deadlines This Month" : "No Deadlines"}
      </div>
    </div>
  );
}

const DeadlinesAgendaRail = forwardRef(function DeadlinesAgendaRail({
  viewYear,
  viewMonth,
  computed,
  selectedDateKey,
  selectedItemId,
  scrollCommand = null,
  currentYear,
  currentMonth,
  todayDate,
  floatingEditorDirty = false,
  onDirtyBlocked,
  onPassiveDateChange,
  onDateAction,
  onDeadlineAction,
  deadlineQuickActions,
}, ref) {
  const todayKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const agenda = useMemo(() => buildDeadlinesAgendaGroups({
    computed,
    viewYear,
    viewMonth,
    todayKey,
    forceVisibleDateKey: selectedDateKey,
  }), [computed, selectedDateKey, todayKey, viewMonth, viewYear]);

  return (
    <AgendaRailShell
      ref={ref}
      testId="deadlines-agenda-rail"
      groups={agenda.visibleGroups}
      firstVisibleDateKey={agenda.firstVisibleDateKey}
      todayKey={todayKey}
      selectedDateKey={selectedDateKey}
      scrollCommand={scrollCommand}
      floatingEditorDirty={floatingEditorDirty}
      onDirtyBlocked={onDirtyBlocked}
      onPassiveDateChange={onPassiveDateChange}
      renderHeader={({ group, registerHeader }) => (
        <AgendaHeader
          group={group}
          todayKey={todayKey}
          registerHeader={registerHeader}
          onActivate={onDateAction}
        />
      )}
      renderGroup={({ group, registerRow, registerContent }) => (
        <>
          {group.items.map((task) => (
            <span
              key={task.agendaKey}
              ref={(node) => registerRow(task.agendaKey, node, group.dateKey)}
            >
              <DeadlineRow
                task={task}
                selected={String(selectedItemId || "") === task.agendaItemId}
                quickActions={deadlineQuickActions}
                onSelect={(item, element) => onDeadlineAction?.({
                  item,
                  dateKey: item.agendaDateKey,
                  anchorElement: element,
                  sourceCellElement: element,
                  anchorKind: "agenda-row",
                })}
              />
            </span>
          ))}
          {!group.hasDeadlines && (group.isFallback || selectedDateKey === group.dateKey) ? (
            <div ref={(node) => registerContent(group.dateKey, node)}>
              <EmptyDeadlineDay fallback={group.isFallback} />
            </div>
          ) : null}
        </>
      )}
    />
  );
});

export default DeadlinesAgendaRail;
