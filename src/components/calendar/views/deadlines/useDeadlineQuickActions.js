import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteDeadline } from "@/api";
import {
  normalizeStatus,
  openInNewTab,
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

function deadlineActionItems(task, { onEdit, onComplete, onRequestDelete }) {
  const isComplete = normalizeStatus(task.status) === "complete";
  return compactItems([
    { id: "edit", label: "Edit deadline", onSelect: onEdit, testId: "calendar-deadline-context-edit" },
    !isComplete && {
      id: "complete",
      label: "Mark complete",
      onSelect: onComplete,
      testId: "calendar-deadline-context-complete",
    },
    { type: "separator" },
    task.url && /todoist/i.test(task.url) && {
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

export default function useDeadlineQuickActions({
  enabled = true,
  actions = {},
  onEditTask,
  onDeleted,
} = {}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [status, setStatus] = useState(null);

  // Callers pass these handlers as inline closures; reading them through a
  // ref keeps the returned actions identity stable across parent re-renders,
  // so memoized month grids holding these actions do not re-render whenever
  // the controller does.
  const externalHandlersRef = useRef(null);
  const contextMenuRef = useRef(null);
  useEffect(() => {
    externalHandlersRef.current = { actions, onEditTask, onDeleted };
    contextMenuRef.current = contextMenu;
  });

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
    if (!task?.id) return;

    setContextMenu((current) => (current ? { ...current, busy: true, error: null } : current));
    setStatus({ tone: "pending", message: "Deleting deadline..." });

    try {
      await deleteDeadline(task.id);
      externalHandlersRef.current.actions?.onDeleteTask?.(task.id);
      externalHandlersRef.current.onDeleted?.(task.id, task);
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
  }, [contextMenu?.task]);

  const editContextTask = useCallback(() => {
    const menu = contextMenuRef.current;
    if (!menu?.task) return;
    externalHandlersRef.current.onEditTask?.(menu.task, menu);
  }, []);

  const completeContextTask = useCallback(() => {
    const task = contextMenuRef.current?.task;
    if (!task) return;
    externalHandlersRef.current.actions?.onCompleteTask?.(task.id, task);
  }, []);

  const menuItems = useMemo(() => {
    const task = contextMenu?.task;
    if (!task) return [];

    // The handlers read refs only when a menu row is clicked, never during
    // render; the rule cannot see past the render-time array construction.
    // eslint-disable-next-line react-hooks/refs
    return deadlineActionItems(task, {
      onEdit: editContextTask,
      onComplete: completeContextTask,
      onRequestDelete: requestDelete,
    });
  }, [completeContextTask, contextMenu, editContextTask, requestDelete]);

  return useMemo(() => ({
    kind: "deadline",
    contextMenu,
    contextMenuTitle: "Deadline",
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
