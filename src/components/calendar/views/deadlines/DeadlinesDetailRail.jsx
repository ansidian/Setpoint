/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense, useState } from "react";
import { useDashboard } from "../../../../context/DashboardContext";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import {
  DEADLINE_COLOR,
  deadlineAccentFor,
  formatFullDate,
  deadlineMatchesItemId,
  getDayState,
  getDeadlineSelectionId,
  normalizeStatus,
} from "./deadlinesModel.js";
import DeadlineDetailCard from "./DeadlineDetailCard.jsx";
import DeadlineSelectedActions from "./DeadlineDetailActions.jsx";
import {
  DeadlineStatusIcon,
} from "./DeadlineStatusIndicator.jsx";
import { shouldCompressDeadlineCard } from "./deadlineDetailModel.js";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy-load AddTaskPanel so the calendar-open chunk stops statically pulling it
// (and the natural-language parser it carries). It only mounts when the deadline
// create/edit editor is actually opened.
const AddTaskPanel = lazy(() => import("../../../todoist/AddTaskPanel"));

// Suspense fallback while the AddTaskPanel chunk loads on a cold cache. Mirrors
// AddTaskPanelInlineEditor's transparent flex-column footprint so the deadline
// create/edit area shows a shimmer in place instead of a blank gap, and the swap
// to the real editor does not jump the layout. Decorative (aria-hidden); it does
// NOT carry the todoist-inline-editor testid, so consumers still wait for the
// real editor to mount.
function AddTaskPanelInlineFallback() {
  return (
    <div
      aria-hidden="true"
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 16 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton className="h-[14px] rounded-sm bg-white/8" style={{ width: 104 }} />
        <Skeleton className="h-[10px] rounded-sm bg-white/8" style={{ width: "78%", opacity: 0.6 }} />
      </div>
      <Skeleton className="h-[40px] rounded-md bg-white/8" style={{ width: "100%" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 2 }}>
        <Skeleton className="h-[34px] rounded-md bg-white/6" style={{ width: "100%" }} />
        <Skeleton className="h-[34px] rounded-md bg-white/6" style={{ width: "100%" }} />
        <Skeleton className="h-[34px] rounded-md bg-white/6" style={{ width: "72%" }} />
      </div>
    </div>
  );
}

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
  accent = "var(--ea-accent)",
  data,
}) {
  const {
    handleCompleteTask,
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
      <Suspense fallback={<AddTaskPanelInlineFallback />}>
        <AddTaskPanel
          host="inline"
          editingTask={editingTask || undefined}
          initialDueDate={seedDate}
          onDraftPreviewChange={onDraftPreviewChange}
          onDirtyChange={onEditorDirtyChange}
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
      </Suspense>
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
            border: "1px solid color-mix(in srgb, var(--sp-cream) 16%, transparent)",
            background: "color-mix(in srgb, var(--sp-cream) 6%, transparent)",
            color: "color-mix(in srgb, var(--sp-cream) 86%, transparent)",
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
            const subtitle = task.class_name || task.project_name || "Deadline";
            const metaParts = [];
            if (normalizeStatus(task.status) === "in_progress") metaParts.push("In progress");
            const itemId = getDeadlineSelectionId(task, task.agendaDateKey || task.due_date || selectedDateKey);

            return {
              id: itemId,
              timeLabel: task.due_time || "End of day",
              title: task.title || task.name || "Untitled",
              subtitle,
              meta: metaParts.join(" · "),
              dotColor: deadlineAccentFor(task, DEADLINE_COLOR),
              complete: normalizeStatus(task.status) === "complete",
              trailing: (
                <DeadlineStatusIcon
                  status={task.status}
                  size={14}
                  testId={`deadline-status-indicator-${task.id}`}
                />
              ),
              selected: deadlineMatchesItemId(task, selectedItemId, selectedDateKey),
              onClick: () => onSelectItem?.(itemId),
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
            const subtitle = task.class_name || task.project_name || "Deadline";
            const metaParts = [];
            metaParts.push("Complete");
            const itemId = getDeadlineSelectionId(task, task.agendaDateKey || task.due_date || selectedDateKey);

            return {
              id: itemId,
              timeLabel: task.due_time || "End of day",
              title: task.title || task.name || "Untitled",
              subtitle,
              meta: metaParts.join(" · "),
              dotColor: deadlineAccentFor(task, DEADLINE_COLOR),
              complete: true,
              trailing: (
                <DeadlineStatusIcon
                  status={task.status}
                  size={14}
                  testId={`deadline-status-indicator-${task.id}`}
                />
              ),
              selected: deadlineMatchesItemId(task, selectedItemId, selectedDateKey),
              onClick: () => onSelectItem?.(itemId),
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
  onCloseFloatingDetail,
  accent = "var(--ea-accent)",
  hideEdit = false,
}) {
  const {
    handleCompleteTask,
  } = useDashboard();

  const state = getDayState(items);
  const allItems = [...state.activeItems, ...state.completedItems];
  const selectedTask = allItems.find((task) => deadlineMatchesItemId(task, selectedItemId, selectedDateKey)) || null;

  if (!selectedTask) return null;
  const sourceAccent = deadlineAccentFor(selectedTask, accent);
  const closeAfterFeedback = () => {
    if (!onCloseFloatingDetail) return;
    window.setTimeout(() => onCloseFloatingDetail(), 120);
  };
  const handleFloatingComplete = (taskId, taskSnapshot) => {
    const result = handleCompleteTask(taskId, taskSnapshot);
    closeAfterFeedback();
    return result;
  };
  return (
    <DeadlineDetailCard
      task={selectedTask}
      accent={sourceAccent}
      compact
      ultraCompact
      actions={
        <DeadlineSelectedActions
          task={selectedTask}
          accent={sourceAccent}
          onEdit={onStartEdit}
          onComplete={handleFloatingComplete}
          compact
          hideEdit={hideEdit}
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
