import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteDeadline } from "@/api";
import { nativeDragSupported } from "../../calendarDragSupport.ts";
import { resolveDeadlineRescheduleTarget } from "./calendarDeadlineRescheduleModel.ts";
import {
  normalizeStatus,
  openInNewTab,
} from "./deadlinesModel.ts";
import type { DeadlineItem } from "./deadlinesModel";

export type DeadlineMenuItem =
  | { type: "separator" }
  | { id?: string; label: string; onSelect?: () => void; testId?: string; tone?: string; disabled?: boolean; type?: undefined };

export interface DeadlineContextMenu {
  task: DeadlineItem;
  x: number;
  y: number;
  anchorElement: HTMLElement | null;
  sourceCellElement: HTMLElement | null;
  exclusionElement: HTMLElement | null;
  dateKey: string | null;
  anchorKind: string;
  confirm: boolean;
  busy: boolean;
  error: string | null;
}

export interface DeadlineQuickActionStatus {
  tone: "pending" | "success" | "error";
  message: string;
}

export interface DeadlineQuickActions {
  kind: "deadline";
  contextMenu: DeadlineContextMenu | null;
  contextMenuTitle: string;
  menuItems: DeadlineMenuItem[];
  status: DeadlineQuickActionStatus | null;
  clearStatus: () => void;
  openContextMenu: (payload?: DeadlineContextPayload | null) => boolean;
  requestDelete: () => void;
  confirmContextDelete: () => Promise<void>;
  closeContextMenu: () => void;
  dragEnabled: boolean;
  draggingDeadlineId: string | null;
  dropTargetDate: string | null;
  beginDrag: (task?: DeadlineItem | null) => boolean;
  endDrag: () => void;
  enterDropTarget: (dateKey: string) => void;
  leaveDropTarget: (dateKey: string) => void;
  dropDeadline: (input: { deadline?: DeadlineItem | null; targetDate?: string | null }) => void;
}

interface DeadlineContextPayload {
  task?: DeadlineItem;
  item?: DeadlineItem & { sourceItem?: DeadlineItem };
  x?: number;
  y?: number;
  anchorElement?: HTMLElement | null;
  sourceCellElement?: HTMLElement | null;
  exclusionElement?: HTMLElement | null;
  dateKey?: string | null;
  anchorKind?: string;
}

interface DeadlineExternalActions {
  onDeleteTask?: (id: string) => void;
  onCompleteTask?: (id: string | undefined, task: DeadlineItem) => void;
  onMoveTask?: (task: DeadlineItem, target: string) => void;
}

export interface UseDeadlineQuickActionsOptions {
  enabled?: boolean;
  layout?: { stacked?: boolean } | null;
  actions?: DeadlineExternalActions;
  onEditTask?: (task: DeadlineItem, menu: DeadlineContextMenu) => void;
  onDeleted?: (id: string, task: DeadlineItem) => void;
}

function compactItems(items: Array<DeadlineMenuItem | false | null | undefined>): DeadlineMenuItem[] {
  const compacted: DeadlineMenuItem[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === "separator") {
      const previous = compacted[compacted.length - 1];
      if (!previous || previous.type === "separator") continue;
    }
    compacted.push(item);
  }
  if (compacted[compacted.length - 1]?.type === "separator") compacted.pop();
  return compacted;
}

function deadlineActionItems(task: DeadlineItem, { onEdit, onComplete, onRequestDelete }: {
  onEdit: () => void;
  onComplete: () => void;
  onRequestDelete: () => void;
}): DeadlineMenuItem[] {
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
    !!task.url && /todoist/i.test(task.url) && {
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
  layout,
  actions = {},
  onEditTask,
  onDeleted,
}: UseDeadlineQuickActionsOptions = {}): DeadlineQuickActions {
  const [contextMenu, setContextMenu] = useState<DeadlineContextMenu | null>(null);
  const [status, setStatus] = useState<DeadlineQuickActionStatus | null>(null);
  // Day-only drag-reschedule, gated the same way as event drag: desktop +
  // fine pointer only (recurring/complete are excluded per-drag below).
  const dragEnabled = nativeDragSupported(layout);
  const [draggingDeadlineId, setDraggingDeadlineId] = useState<string | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);

  // Callers pass these handlers as inline closures; reading them through a
  // ref keeps the returned actions identity stable across parent re-renders,
  // so memoized month grids holding these actions do not re-render whenever
  // the controller does.
  const externalHandlersRef = useRef<{ actions: DeadlineExternalActions; onEditTask?: UseDeadlineQuickActionsOptions["onEditTask"]; onDeleted?: UseDeadlineQuickActionsOptions["onDeleted"] }>({ actions });
  const contextMenuRef = useRef<DeadlineContextMenu | null>(null);
  useEffect(() => {
    externalHandlersRef.current = { actions, onEditTask, onDeleted };
    contextMenuRef.current = contextMenu;
  });

  const clearStatus = useCallback(() => setStatus(null), []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openContextMenu = useCallback((payload?: DeadlineContextPayload | null) => {
    const task = payload?.task || payload?.item?.sourceItem || payload?.item;
    if (!enabled || !task?.id || task.isGhost) return false;
    setStatus(null);
    setContextMenu({
      task,
      x: payload?.x || 0,
      y: payload?.y || 0,
      anchorElement: payload?.anchorElement || null,
      sourceCellElement: payload?.sourceCellElement || null,
      exclusionElement: payload?.exclusionElement || null,
      dateKey: payload?.dateKey || task.due_date || null,
      anchorKind: payload?.anchorKind || "chip",
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete deadline.";
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

  const beginDrag = useCallback((task?: DeadlineItem | null) => {
    if (!dragEnabled || !task || task.is_recurring || normalizeStatus(task.status) === "complete") return false;
    setDraggingDeadlineId(String(task.id));
    setStatus(null);
    return true;
  }, [dragEnabled]);

  const endDrag = useCallback(() => {
    setDraggingDeadlineId(null);
    setDropTargetDate(null);
  }, []);

  const enterDropTarget = useCallback((dateKey: string) => {
    if (!draggingDeadlineId) return;
    setDropTargetDate(dateKey);
  }, [draggingDeadlineId]);

  const leaveDropTarget = useCallback((dateKey: string) => {
    setDropTargetDate((current) => (current === dateKey ? null : current));
  }, []);

  const dropDeadline = useCallback(({ deadline, targetDate }: { deadline?: DeadlineItem | null; targetDate?: string | null }) => {
    setDropTargetDate(null);
    setDraggingDeadlineId(null);
    if (!deadline) return;
    const target = resolveDeadlineRescheduleTarget(deadline.due_date, targetDate);
    if (!target) return;
    externalHandlersRef.current.actions?.onMoveTask?.(deadline, target);
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
    dragEnabled,
    draggingDeadlineId,
    dropTargetDate,
    beginDrag,
    endDrag,
    enterDropTarget,
    leaveDropTarget,
    dropDeadline,
  }), [
    clearStatus,
    closeContextMenu,
    confirmContextDelete,
    contextMenu,
    menuItems,
    openContextMenu,
    requestDelete,
    status,
    dragEnabled,
    draggingDeadlineId,
    dropTargetDate,
    beginDrag,
    endDrag,
    enterDropTarget,
    leaveDropTarget,
    dropDeadline,
  ]);
}
