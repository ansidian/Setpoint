/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { Check, Circle, CircleDashed, ExternalLink, Flag, Pencil, Plus } from "lucide-react";
import { parseDueDate } from "../../../lib/dashboard-helpers";
import { daysUntil } from "../../../lib/bill-utils";
import { dueDateToMs, daysLabel, urgencyForDays } from "../../../lib/redesign-helpers";
import { useDashboard } from "../../../context/DashboardContext.jsx";
import AddTaskPanel from "../../todoist/AddTaskPanel";
import TimelineDetailRail from "../TimelineDetailRail.jsx";

const MAX_PILLS = 2;

const SOURCE_COLORS = {
  canvas: "#5A8FBF",
  manual: "#5A8FBF",
  todoist: "#e8776a",
};

const PRIORITY_META = {
  1: { color: "#f38ba8", label: "P1 · Urgent" },
  2: { color: "#f9e2af", label: "P2 · High" },
  3: { color: "#89b4fa", label: "P3 · Medium" },
};

function sourceOf(task) {
  return task?.source || "canvas";
}

function normalizeStatus(status) {
  if (status === "open") return "incomplete";
  return status || "incomplete";
}

function statusLabel(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "complete") return "Complete";
  if (normalized === "in_progress") return "In progress";
  return "Incomplete";
}

function openInNewTab(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function formatFullDate(year, month, day) {
  if (day == null) return "Selected deadline";
  const d = new Date(year, month, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function sourceLabelFor(task) {
  const source = sourceOf(task);
  return source === "todoist" ? "Todoist" : source === "canvas" ? "Canvas" : "CTM";
}

function orderDeadlines(items = []) {
  return [...items].sort((a, b) => {
    const aMs = dueDateToMs(a.due_date, a.due_time) ?? Number.POSITIVE_INFINITY;
    const bMs = dueDateToMs(b.due_date, b.due_time) ?? Number.POSITIVE_INFINITY;
    if (aMs !== bMs) return aMs - bMs;
    const aComplete = normalizeStatus(a.status) === "complete" ? 1 : 0;
    const bComplete = normalizeStatus(b.status) === "complete" ? 1 : 0;
    if (aComplete !== bComplete) return aComplete - bComplete;
    return (a.title || "").localeCompare(b.title || "");
  });
}

function groupDeadlines(items = []) {
  const ordered = orderDeadlines(items);
  const activeItems = ordered.filter((item) => normalizeStatus(item.status) !== "complete");
  const completedItems = ordered.filter((item) => normalizeStatus(item.status) === "complete");
  return {
    items: ordered,
    activeItems,
    completedItems,
    activeCount: activeItems.length,
    completedCount: completedItems.length,
    totalCount: ordered.length,
  };
}

function getDayState(rawItems) {
  if (rawItems?.activeItems) return rawItems;
  return groupDeadlines(Array.isArray(rawItems) ? rawItems : []);
}

function getDefaultSelectedItemId(items = []) {
  const state = getDayState(items);
  const firstOpen = state.activeItems[0];
  const fallback = firstOpen || state.completedItems[0];
  return String(fallback?.id || "");
}

function CompletedCount({ count }) {
  if (!count) return null;
  return (
    <div
      style={{
        marginTop: 4,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        color: "rgba(166,227,161,0.55)",
        letterSpacing: 0.2,
      }}
    >
      <Check size={10} />
      <span>{count}</span>
    </div>
  );
}

function CompletedPreview({ task, count }) {
  const source = sourceOf(task);
  const dot = SOURCE_COLORS[source] || "rgba(255,255,255,0.3)";

  return (
    <div
      style={{
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dot,
          opacity: 0.6,
          boxShadow: `0 0 4px ${dot}30`,
        }}
      />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "rgba(205,214,244,0.42)",
          fontSize: 11,
          textDecoration: "line-through",
          textDecorationColor: "rgba(205,214,244,0.2)",
        }}
      >
        {task.title || task.name || "Untitled"}
      </span>
      {count > 1 && <CompletedCount count={count} />}
    </div>
  );
}

function compute({ data, viewYear, viewMonth }) {
  const ctmItems = data?.ctm?.upcoming || [];
  const todoistItems = data?.todoist?.upcoming || [];
  const all = [...ctmItems, ...todoistItems];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const itemsByDay = {};
  let earliestOverdue = null;
  for (const t of all) {
    if (!t.due_date) continue;
    const d = parseDueDate(t.due_date);
    if (Number.isNaN(d.getTime())) continue;

    if (normalizeStatus(t.status) !== "complete" && d < today) {
      if (!earliestOverdue || d < earliestOverdue) earliestOverdue = d;
    }

    if (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth) continue;
    const day = d.getDate();
    if (!itemsByDay[day]) itemsByDay[day] = [];
    itemsByDay[day].push(t);
  }

  for (const day of Object.keys(itemsByDay)) {
    itemsByDay[day] = groupDeadlines(itemsByDay[day]);
  }

  return { itemsByDay, earliestOverdue };
}

function canNavigateBack({ viewYear, viewMonth, currentYear, currentMonth, computed }) {
  const currentIdx = currentYear * 12 + currentMonth;
  const viewIdx = viewYear * 12 + viewMonth;
  if (viewIdx > currentIdx) return true;
  const earliest = computed?.earliestOverdue;
  if (!earliest) return false;
  const earliestIdx = earliest.getFullYear() * 12 + earliest.getMonth();
  return viewIdx > earliestIdx;
}

function hasOverdue(items) {
  const state = getDayState(items);
  return state.activeItems.some((t) => t._overdueHint);
}

function allComplete(_items) {
  return false;
}

function renderCellContents({ items }) {
  const state = getDayState(items);
  const completedPreview = state.activeCount === 0 ? state.completedItems[0] : null;
  return (
    <>
      {state.activeItems.slice(0, MAX_PILLS).map((t) => {
        const source = sourceOf(t);
        const dot = SOURCE_COLORS[source] || "rgba(255,255,255,0.3)";
        return (
          <div
            key={`${source}-${t.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              marginTop: 3,
              minWidth: 0,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: dot,
                opacity: 0.9,
                boxShadow: `0 0 4px ${dot}60`,
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                color: "rgba(205,214,244,0.55)",
              }}
            >
              {t.title || t.name || "Untitled"}
            </span>
          </div>
        );
      })}
      {state.activeCount > MAX_PILLS && (
        <div style={{ fontSize: 10, color: "rgba(203,166,218,0.6)", marginTop: 2 }}>
          +{state.activeCount - MAX_PILLS} more
        </div>
      )}
      {completedPreview ? (
        <CompletedPreview task={completedPreview} count={state.completedCount} />
      ) : (
        <CompletedCount count={state.completedCount} />
      )}
    </>
  );
}

function ActionButton({ icon, label, onClick, accent, variant = "default", disabled = false, loading = false }) {
  const [hovered, setHovered] = useState(false);
  const IconComponent = icon;
  const isPrimary = variant === "primary";
  const isAccent = variant === "accent";
  const accentSoftWash = `color-mix(in srgb, ${accent} 10%, transparent)`;
  const accentBorder = `color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.06))`;
  const accentHoverBorder = `color-mix(in srgb, ${accent} 24%, rgba(255,255,255,0.08))`;
  const accentGlow = `0 0 0 1px color-mix(in srgb, ${accent} 8%, transparent), 0 8px 18px color-mix(in srgb, ${accent} 8%, transparent)`;
  const color = isPrimary
    ? "#a6e3a1"
    : isAccent
      ? accent
      : "rgba(205,214,244,0.8)";
  const background = isPrimary
    ? "rgba(166,227,161,0.1)"
    : isAccent
      ? "rgba(255,255,255,0.015)"
      : "rgba(255,255,255,0.02)";
  const border = isPrimary
    ? "1px solid rgba(166,227,161,0.28)"
    : isAccent
      ? `1px solid ${accentBorder}`
      : "1px solid rgba(255,255,255,0.08)";
  const hoverBackground = isPrimary
    ? "rgba(166,227,161,0.16)"
    : isAccent
      ? accentSoftWash
      : "rgba(255,255,255,0.045)";
  const hoverBorder = isPrimary
    ? "rgba(166,227,161,0.4)"
    : isAccent
      ? accentHoverBorder
      : "rgba(255,255,255,0.14)";
  const hoverShadow = isPrimary
    ? "0 8px 18px rgba(166,227,161,0.12)"
    : isAccent
      ? accentGlow
      : "none";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 11px",
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        background: hovered ? hoverBackground : background,
        border: hovered ? `1px solid ${hoverBorder}` : border,
        color,
        opacity: disabled ? 0.58 : 1,
        whiteSpace: "nowrap",
        transform: hovered && !isAccent && !disabled ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hovered ? hoverShadow : "none",
        transition: "background 140ms, border-color 140ms, transform 140ms, box-shadow 140ms",
      }}
    >
      {loading ? (
        <span
          aria-hidden
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            border: "1.5px solid currentColor",
            borderTopColor: "transparent",
            animation: "spin 700ms linear infinite",
          }}
        />
      ) : (
        <IconComponent size={11} />
      )}
      <span>{label}</span>
    </button>
  );
}

function InfoRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
      <span
        style={{
          color: "rgba(205,214,244,0.45)",
          letterSpacing: 0.3,
          textTransform: "uppercase",
          fontSize: 9.5,
          fontWeight: 600,
          width: 60,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: color || "rgba(205,214,244,0.85)",
          fontWeight: 500,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PriorityBadge({ level }) {
  const meta = PRIORITY_META[level];
  if (!meta) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: meta.color,
        background: `${meta.color}1e`,
        border: `1px solid ${meta.color}38`,
      }}
    >
      <Flag size={10} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

function DetailCard({ task, accent, onEdit, onComplete, onStatusChange }) {
  const source = sourceOf(task);
  const sourceLabel = sourceLabelFor(task);
  const sourceColor = SOURCE_COLORS[source] || accent;
  const isTodoist = source === "todoist";
  const normalizedStatus = normalizeStatus(task.status);
  const isCompleting = !!task._completing;
  const ctmUrl = `https://ctm.andysu.tech/#/event/${task.id}`;
  const dueDays = daysUntil(task.due_date);
  const urgency = urgencyForDays(dueDays, accent);
  const dueColor = task.due_date
    ? urgency.key === "high"
      ? "#f38ba8"
      : urgency.key === "medium"
        ? "#f9e2af"
        : accent
    : "rgba(205,214,244,0.7)";

  return (
    <div
      style={{
        padding: "14px 14px 12px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.02)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: sourceColor,
          }}
        >
          {sourceLabel}
        </div>
      </div>

      <div>
        <div
          className="ea-display"
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "#fff",
            lineHeight: 1.3,
            letterSpacing: -0.2,
            textDecoration: normalizedStatus === "complete" ? "line-through" : "none",
            textDecorationColor: "rgba(205,214,244,0.35)",
          }}
        >
          {task.title || "Untitled task"}
        </div>
        {(task.class_name || task.project_name) && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: "rgba(205,214,244,0.5)",
            }}
          >
            {task.class_name || task.project_name}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <InfoRow
          label="Due"
          value={task.due_date
            ? `${daysLabel(dueDays)}${task.due_time ? ` · ${task.due_time}` : ""}`
            : "No due date"}
          color={dueColor}
        />
        <InfoRow label="Status" value={statusLabel(task.status)} />
        {isTodoist && PRIORITY_META[task.priority] && (
          <InfoRow label="Priority" value={<PriorityBadge level={task.priority} />} />
        )}
        {task.points_possible != null && (
          <InfoRow label="Points" value={`${task.points_possible}`} />
        )}
      </div>

      <div
        style={{
          paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {isTodoist ? (
          <>
            {normalizedStatus !== "complete" && (
              <ActionButton
                icon={Check}
                label={isCompleting ? "Completing..." : "Mark complete"}
                variant="primary"
                accent={accent}
                disabled={isCompleting}
                loading={isCompleting}
                onClick={() => onComplete(task.id)}
              />
            )}
            <ActionButton
              icon={Pencil}
              label="Edit"
              accent={accent}
              disabled={isCompleting}
              onClick={() => onEdit(task)}
            />
            {task.url && (
              <ActionButton
                icon={ExternalLink}
                label="Open in Todoist"
                variant="accent"
                accent={accent}
                disabled={isCompleting}
                onClick={() => openInNewTab(task.url)}
              />
            )}
          </>
        ) : (
          <>
            {normalizedStatus !== "complete" && (
              <ActionButton
                icon={Check}
                label="Mark complete"
                variant="primary"
                accent={accent}
                onClick={() => onStatusChange(task.id, "complete")}
              />
            )}
            {normalizedStatus !== "in_progress" && (
              <ActionButton
                icon={CircleDashed}
                label="In progress"
                accent={accent}
                onClick={() => onStatusChange(task.id, "in_progress")}
              />
            )}
            {normalizedStatus !== "incomplete" && (
              <ActionButton
                icon={Circle}
                label="Reopen"
                accent={accent}
                onClick={() => onStatusChange(task.id, "incomplete")}
              />
            )}
            {task.url && /instructure\.com|canvas/i.test(task.url) && (
              <ActionButton
                icon={ExternalLink}
                label="Open in Canvas"
                variant="accent"
                accent={accent}
                onClick={() => openInNewTab(task.url)}
              />
            )}
            <ActionButton
              icon={ExternalLink}
              label="Open in CTM"
              variant="accent"
              accent={accent}
              onClick={() => openInNewTab(ctmUrl)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function DeadlinesHeaderExtras({ onCreateTask }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onCreateTask?.()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderRadius: 8,
        border: hovered ? "1px solid rgba(203,166,218,0.42)" : "1px solid rgba(203,166,218,0.28)",
        background: hovered ? "rgba(203,166,218,0.16)" : "rgba(203,166,218,0.1)",
        color: "#cba6da",
        fontFamily: "inherit",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hovered ? "0 10px 22px rgba(203,166,218,0.12)" : "none",
        transition: "background 140ms, border-color 140ms, transform 140ms, box-shadow 140ms",
      }}
    >
      <Plus size={12} />
      <span>New Todoist</span>
    </button>
  );
}

function DeadlinesDetail({
  selectedDay,
  viewYear,
  viewMonth,
  items,
  selectedItemId,
  onSelectItem,
  editorState,
  onStartEdit,
  onCloseEditor,
  onTaskSaved,
  onTaskDeleted,
  accent = "var(--ea-accent)",
}) {
  const {
    handleCompleteTask,
    handleUpdateTaskStatus,
    handleUpdateTask,
    handleAddTask,
    handleDeleteTask,
  } = useDashboard();

  const state = getDayState(items);
  const allItems = [...state.activeItems, ...state.completedItems];
  const selectedTask = allItems.find((task) => String(task.id) === String(selectedItemId))
    || state.activeItems[0]
    || state.completedItems[0]
    || null;
  const [showCompleted, setShowCompleted] = useState(
    state.activeCount === 0 || normalizeStatus(selectedTask?.status) === "complete",
  );
  const summary = [
    `${state.activeCount} open`,
    state.completedCount ? `${state.completedCount} complete` : null,
    `${state.totalCount} total`,
  ].filter(Boolean).join(" · ");

  const expandedCompleted = showCompleted || normalizeStatus(selectedTask?.status) === "complete";

  if (editorState?.mode) {
    const editingTask = editorState.mode === "edit"
      ? allItems.find((task) => String(task.id) === String(editorState.taskId)) || selectedTask
      : null;
    const seedDate = editingTask ? null : editorState.seedDate || null;

    return (
      <AddTaskPanel
        host="inline"
        editingTask={editingTask || undefined}
        initialDueDate={seedDate}
        onClose={onCloseEditor}
        onTaskAdded={(task) => {
          handleAddTask(task);
          onTaskSaved?.(task);
        }}
        onTaskUpdated={(task) => {
          handleUpdateTask(task);
          onTaskSaved?.(task);
        }}
        onTaskDeleted={(taskId) => {
          handleDeleteTask(taskId);
          onTaskDeleted?.(taskId);
        }}
      />
    );
  }

  return (
    <TimelineDetailRail
      title={formatFullDate(viewYear, viewMonth, selectedDay)}
      summary={summary}
      headerContent={
        selectedTask ? (
          <DetailCard
            task={selectedTask}
            accent={accent}
            onEdit={onStartEdit}
            onComplete={handleCompleteTask}
            onStatusChange={handleUpdateTaskStatus}
          />
        ) : null
      }
      sections={[
        {
          id: "active-deadlines",
          label: "Active",
          items: state.activeItems.map((task) => {
            const sourceLabel = sourceLabelFor(task);
            const subtitle = task.class_name || task.project_name || sourceLabel;
            const metaParts = [];
            if (subtitle !== sourceLabel) metaParts.push(sourceLabel);
            if (normalizeStatus(task.status) === "in_progress") metaParts.push("In progress");

            return {
              id: `${sourceOf(task)}-${task.id}`,
              timeLabel: task.due_time || "End of day",
              title: task.title || task.name || "Untitled",
              titleClassName: "ea-display",
              subtitle,
              meta: metaParts.join(" · "),
              dotColor: SOURCE_COLORS[sourceOf(task)] || "rgba(255,255,255,0.3)",
              complete: normalizeStatus(task.status) === "complete",
              selected: String(task.id) === String(selectedTask?.id),
              onClick: () => onSelectItem?.(String(task.id)),
            };
          }),
        },
        {
          id: "completed-deadlines",
          label: "Completed",
          collapsible: true,
          expanded: expandedCompleted,
          onToggle: () => setShowCompleted((prev) => !prev),
          itemCount: state.completedCount,
          items: state.completedItems.map((task) => {
            const sourceLabel = sourceLabelFor(task);
            const subtitle = task.class_name || task.project_name || sourceLabel;
            const metaParts = [];
            if (subtitle !== sourceLabel) metaParts.push(sourceLabel);
            metaParts.push("Complete");

            return {
              id: `${sourceOf(task)}-${task.id}`,
              timeLabel: task.due_time || "End of day",
              title: task.title || task.name || "Untitled",
              titleClassName: "ea-display",
              subtitle,
              meta: metaParts.join(" · "),
              dotColor: SOURCE_COLORS[sourceOf(task)] || "rgba(255,255,255,0.3)",
              complete: true,
              selected: String(task.id) === String(selectedTask?.id),
              onClick: () => onSelectItem?.(String(task.id)),
            };
          }),
        },
      ]}
    />
  );
}

function renderDetail(props) {
  const state = getDayState(props.items);
  return <DeadlinesDetail key={`${props.selectedDay}-${state.activeCount}-${state.completedCount}`} {...props} />;
}

function renderFooter({ viewYear, viewMonth, currentYear, currentMonth, todayDate, itemsByDay, data }) {
  const total = Object.values(itemsByDay).reduce((sum, day) => sum + getDayState(day).totalCount, 0);
  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;

  let dueToday = 0;
  let dueThisWeek = 0;
  if (isCurrentMonth) {
    const allItems = [
      ...(data?.ctm?.upcoming || []),
      ...(data?.todoist?.upcoming || []),
    ];
    const today = new Date(currentYear, currentMonth, todayDate);
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    for (const t of allItems) {
      if (normalizeStatus(t.status) === "complete" || !t.due_date) continue;
      const d = new Date(`${t.due_date}T00:00:00`);
      if (Number.isNaN(d.getTime())) continue;
      if (d.getTime() === today.getTime()) dueToday++;
      if (d >= weekStart && d <= weekEnd) dueThisWeek++;
    }
  }

  const StatRow = ({ value, label }) => (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ fontSize: 11, color: "rgba(205,214,244,0.55)" }}>{label}</span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 500,
          color: "#fff",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.2,
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {isCurrentMonth && <StatRow value={dueToday} label="Due today" />}
      {isCurrentMonth && <StatRow value={dueThisWeek} label="Due this week" />}
      <StatRow value={total} label="Total this month" />
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 10 }}>
        <LegendDot color={SOURCE_COLORS.canvas} label="Canvas" />
        <LegendDot color={SOURCE_COLORS.todoist} label="Todoist" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}60`,
        }}
      />
      {label}
    </span>
  );
}

const deadlinesView = {
  compute,
  canNavigateBack,
  getDayState,
  hasOverdue,
  allComplete,
  renderCellContents,
  renderDetail,
  renderFooter,
  HeaderExtras: DeadlinesHeaderExtras,
  getDefaultSelectedItemId,
  label: "Deadlines",
};

export default deadlinesView;
