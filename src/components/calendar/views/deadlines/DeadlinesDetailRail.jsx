/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { useDashboard } from "../../../../context/DashboardContext.jsx";
import AddTaskPanel from "../../../todoist/AddTaskPanel";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import {
  formatFullDate,
  deadlineMatchesItemId,
  getDayState,
  getDeadlineSelectionId,
  normalizeStatus,
  SOURCE_COLORS,
  sourceLabelFor,
  sourceOf,
} from "./deadlinesModel.js";
import DeadlineDetailCard from "./DeadlineDetailCard.jsx";
import DeadlineSelectedActions from "./DeadlineDetailActions.jsx";
import {
  DeadlineStatusIcon,
} from "./DeadlineStatusIndicator.jsx";
import { shouldCompressDeadlineCard } from "./deadlineDetailModel.js";

function DeadlinesDetail({
  selectedDay,
  selectedDateKey,
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
  onDraftPreviewChange,
  onEditorDirtyChange,
  transientCloseToken,
  accent = "var(--ea-accent)",
  data,
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
  const selectedTask = allItems.find((task) => deadlineMatchesItemId(task, selectedItemId, selectedDateKey)) || null;
  const compressedSelectedCard = state.totalCount >= 2 || shouldCompressDeadlineCard(selectedTask);
  const compactDetail = state.totalCount >= 2;
  const effectiveCompactDetail = compactDetail || compressedSelectedCard;
  const [showCompleted, setShowCompleted] = useState(
    state.activeCount === 0 || normalizeStatus(selectedTask?.status) === "complete",
  );
  const summary = [
    `${state.activeCount} open`,
    state.completedCount ? `${state.completedCount} complete` : null,
    `${state.totalCount} total`,
  ].filter(Boolean).join(" · ");

  const expandedCompleted = showCompleted || normalizeStatus(selectedTask?.status) === "complete";
  const sourceErrors = Array.isArray(data?.errors) ? data.errors : [];

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
        onDraftPreviewChange={onDraftPreviewChange}
        onDirtyChange={onEditorDirtyChange}
        transientCloseToken={transientCloseToken}
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
      eyebrow="Deadline ledger"
      title={formatFullDate(viewYear, viewMonth, selectedDay, selectedDateKey)}
      summary={summary}
      accent={accent}
      headerContent={
        selectedTask ? (
          <DeadlineDetailCard
            task={selectedTask}
            accent={accent}
            compact={effectiveCompactDetail}
            ultraCompact={compressedSelectedCard}
            actions={
              <DeadlineSelectedActions
                task={selectedTask}
                accent={accent}
                onEdit={onStartEdit}
                onComplete={handleCompleteTask}
                onStatusChange={handleUpdateTaskStatus}
                compact={effectiveCompactDetail}
              />
            }
          />
        ) : null
      }
      actionContent={sourceErrors.length ? (
        <div
          data-testid="calendar-deadlines-source-warning"
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(249,226,175,0.16)",
            background: "rgba(249,226,175,0.06)",
            color: "rgba(249,226,175,0.86)",
            fontSize: 11,
            lineHeight: 1.35,
          }}
        >
          Some deadline sources are temporarily unavailable.
        </div>
      ) : null}
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
              id: getDeadlineSelectionId(task),
              timeLabel: task.due_time || "End of day",
              title: task.title || task.name || "Untitled",
              subtitle,
              meta: metaParts.join(" · "),
              dotColor: SOURCE_COLORS[sourceOf(task)] || "rgba(255,255,255,0.3)",
              complete: normalizeStatus(task.status) === "complete",
              trailing: (
                <DeadlineStatusIcon
                  status={task.status}
                  size={14}
                  testId={`deadline-status-indicator-${task.id}`}
                />
              ),
              selected: deadlineMatchesItemId(task, selectedItemId, selectedDateKey),
              onClick: () => onSelectItem?.(getDeadlineSelectionId(task)),
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
              id: getDeadlineSelectionId(task),
              timeLabel: task.due_time || "End of day",
              title: task.title || task.name || "Untitled",
              subtitle,
              meta: metaParts.join(" · "),
              dotColor: SOURCE_COLORS[sourceOf(task)] || "rgba(255,255,255,0.3)",
              complete: true,
              trailing: (
                <DeadlineStatusIcon
                  status={task.status}
                  size={14}
                  testId={`deadline-status-indicator-${task.id}`}
                />
              ),
              selected: deadlineMatchesItemId(task, selectedItemId, selectedDateKey),
              onClick: () => onSelectItem?.(getDeadlineSelectionId(task)),
            };
          }),
        },
      ]}
    />
  );
}

function DeadlinesFloatingDetail({
  items,
  selectedItemId,
  selectedDateKey,
  onStartEdit,
  accent = "var(--ea-accent)",
}) {
  const {
    handleCompleteTask,
    handleUpdateTaskStatus,
  } = useDashboard();

  const state = getDayState(items);
  const allItems = [...state.activeItems, ...state.completedItems];
  const selectedTask = allItems.find((task) => deadlineMatchesItemId(task, selectedItemId, selectedDateKey)) || null;
  const compressedSelectedCard = state.totalCount >= 2 || shouldCompressDeadlineCard(selectedTask);
  const compactDetail = state.totalCount >= 2;
  const effectiveCompactDetail = compactDetail || compressedSelectedCard;

  if (!selectedTask) return null;
  const sourceAccent = SOURCE_COLORS[sourceOf(selectedTask)] || accent;

  return (
    <DeadlineDetailCard
      task={selectedTask}
      accent={sourceAccent}
      compact={effectiveCompactDetail}
      ultraCompact={compressedSelectedCard}
      actions={
        <DeadlineSelectedActions
          task={selectedTask}
          accent={sourceAccent}
          onEdit={onStartEdit}
          onComplete={handleCompleteTask}
          onStatusChange={handleUpdateTaskStatus}
          compact={effectiveCompactDetail}
        />
      }
    />
  );
}

export function renderDeadlinesDetail(props) {
  const state = getDayState(props.items);
  const editorKey = props.editorState?.mode
    ? `editor-${props.editorState.mode}-${props.editorState.taskId || props.editorState.seedDate || "new"}`
    : null;
  return <DeadlinesDetail key={editorKey || `${props.selectedDay}-${state.activeCount}-${state.completedCount}`} {...props} />;
}

export function renderDeadlinesFloatingDetail(props) {
  const state = getDayState(props.items);
  return <DeadlinesFloatingDetail key={`${props.selectedItemId}-${state.activeCount}-${state.completedCount}`} {...props} />;
}
