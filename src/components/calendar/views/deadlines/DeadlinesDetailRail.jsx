/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { Check, Circle, CircleDashed, ExternalLink, Flag, Pencil } from "lucide-react";
import { daysUntil } from "../../../../lib/bill-utils";
import { daysLabel, urgencyForDays } from "../../../../lib/redesign-helpers";
import { useDashboard } from "../../../../context/DashboardContext.jsx";
import AddTaskPanel from "../../../todoist/AddTaskPanel";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import {
  formatFullDate,
  getDayState,
  normalizeStatus,
  openInNewTab,
  PRIORITY_META,
  SOURCE_COLORS,
  sourceLabelFor,
  sourceOf,
  statusLabel,
} from "./deadlinesModel.js";

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

export function renderDeadlinesDetail(props) {
  const state = getDayState(props.items);
  return <DeadlinesDetail key={`${props.selectedDay}-${state.activeCount}-${state.completedCount}`} {...props} />;
}
