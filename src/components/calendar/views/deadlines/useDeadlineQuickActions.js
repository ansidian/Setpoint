import { useCallback, useMemo, useState } from "react";
import { deleteTodoistTask } from "@/api";
import {
  normalizeStatus,
  openInNewTab,
  sourceLabelFor,
  sourceOf,
} from "./deadlinesModel.js";

function compactItems(items) {
  const compacted = [];
  for (const item of items.filter(Boolean)) {
    if (item.type === "separator") {
      const previous = compacted[compacted.length - 1];
      if (!previous || previous.type === "separator") continue;
    }
    compacted.push(item);
  }
  if (compacted[compacted.length - 1]?.type === "separator") compacted.pop();
  return compacted;
}

function ctmUrlFor(task) {
  return `https://ctm.andysu.tech/#/event/${task.id}`;
}

function todoistActionItems(task, { onEdit, onComplete, onRequestDelete }) {
  const isComplete = normalizeStatus(task.status) === "complete";
  return compactItems([
    { id: "edit", label: "Edit task", onSelect: onEdit, testId: "calendar-deadline-context-edit" },
    !isComplete && {
      id: "complete",
      label: "Mark complete",
      onSelect: onComplete,
      testId: "calendar-deadline-context-complete",
    },
    { type: "separator" },
    task.url && {
      id: "open-todoist",
      label: "Open in Todoist",
      onSelect: () => openInNewTab(task.url),
    },
    {
      id: "delete",
      label: "Delete",
      tone: "danger",
      onSelect: onRequestDelete,
      testId: "calendar-deadline-context-delete",
    },
  ]);
}

function ctmActionItems(task, { onStatusChange }) {
  const status = normalizeStatus(task.status);
  const isCanvas = sourceOf(task) === "canvas";
  return compactItems([
    status !== "incomplete" && {
      id: "incomplete",
      label: "Mark incomplete",
      onSelect: () => onStatusChange("incomplete"),
    },
    status !== "in_progress" && {
      id: "in-progress",
      label: "Mark in progress",
      onSelect: () => onStatusChange("in_progress"),
    },
    status !== "complete" && {
      id: "complete",
      label: "Mark complete",
      onSelect: () => onStatusChange("complete"),
      testId: "calendar-deadline-context-complete",
    },
    { type: "separator" },
    isCanvas && task.url && {
      id: "open-canvas",
      label: "Open in Canvas",
      onSelect: () => openInNewTab(task.url),
    },
    {
      id: "open-ctm",
      label: "Open in CTM",
      onSelect: () => openInNewTab(ctmUrlFor(task)),
    },
  ]);
}

function tombstoneActionItems(task, { onDismissGhost }) {
  return compactItems([
    task.url && {
      id: "open-todoist",
      label: "Open in Todoist",
      onSelect: () => openInNewTab(task.url),
    },
    { type: "separator" },
    {
      id: "dismiss",
      label: "Dismiss",
      onSelect: () => onDismissGhost?.(task.id),
    },
  ]);
}

export default function useDeadlineQuickActions({
  enabled = true,
  actions = {},
  onEditTask,
  onDeleted,
} = {}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [status, setStatus] = useState(null);

  const clearStatus = useCallback(() => setStatus(null), []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openContextMenu = useCallback((payload) => {
    const task = payload?.task || payload?.item?.sourceItem || payload?.item;
    if (!enabled || !task?.id || task.isGhost) return false;
    setStatus(null);
    setContextMenu({
      task,
      x: payload.x,
      y: payload.y,
      anchorElement: payload.anchorElement || null,
      sourceCellElement: payload.sourceCellElement || null,
      exclusionElement: payload.exclusionElement || null,
      dateKey: payload.dateKey || task.due_date || null,
      anchorKind: payload.anchorKind || "chip",
      confirm: false,
      busy: false,
      error: null,
    });
    return true;
  }, [enabled]);

  const requestDelete = useCallback(() => {
    setContextMenu((current) => (current ? { ...current, confirm: true, error: null } : current));
  }, []);

  const confirmContextDelete = useCallback(async () => {
    const task = contextMenu?.task;
    if (!task || sourceOf(task) !== "todoist") return;

    setContextMenu((current) => (current ? { ...current, busy: true, error: null } : current));
    setStatus({ tone: "pending", message: "Deleting deadline..." });

    try {
      await deleteTodoistTask(task.id);
      actions.onDeleteTask?.(task.id);
      onDeleted?.(task.id, task);
      setContextMenu(null);
      setStatus({ tone: "success", message: "Deadline deleted." });
      window.setTimeout(() => setStatus(null), 1800);
    } catch (err) {
      const message = err.message || "Failed to delete deadline.";
      setStatus({ tone: "error", message });
      setContextMenu((current) => (current ? {
        ...current,
        busy: false,
        error: message,
      } : current));
    }
  }, [actions, contextMenu?.task, onDeleted]);

  const menuItems = useMemo(() => {
    const task = contextMenu?.task;
    if (!task) return [];

    if (task._tombstone) {
      return tombstoneActionItems(task, {
        onDismissGhost: actions.onDismissGhost,
      });
    }

    if (sourceOf(task) === "todoist") {
      return todoistActionItems(task, {
        onEdit: () => onEditTask?.(task, contextMenu),
        onComplete: () => actions.onCompleteTask?.(task.id, task),
        onRequestDelete: requestDelete,
      });
    }

    return ctmActionItems(task, {
      onStatusChange: (nextStatus) => actions.onUpdateTaskStatus?.(task.id, nextStatus),
    });
  }, [actions, contextMenu, onEditTask, requestDelete]);

  return useMemo(() => ({
    kind: "deadline",
    contextMenu,
    contextMenuTitle: contextMenu?.task
      ? `${sourceLabelFor(contextMenu.task)} deadline`
      : "Deadline",
    menuItems,
    status,
    clearStatus,
    openContextMenu,
    requestDelete,
    confirmContextDelete,
    closeContextMenu,
  }), [
    clearStatus,
    closeContextMenu,
    confirmContextDelete,
    contextMenu,
    menuItems,
    openContextMenu,
    requestDelete,
    status,
  ]);
}
