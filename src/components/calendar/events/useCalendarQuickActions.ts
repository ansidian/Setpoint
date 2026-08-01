import { useCallback, useMemo, useState } from "react";
import { pacificYMD } from "../calendarDateUtils.ts";
import { eventSelectionId } from "./calendarQuickActionModel";
import { nativeDragSupported } from "../calendarDragSupport.ts";
import type {
  CalendarEventClipboard,
} from "./calendarEventSelectionModel";
import type { CalendarQuickActionEvent } from "./calendarQuickActionModel";
import type { CalendarRecurrenceScope } from "../../../../shared/types/calendar";

export type { QuickActionScope, QuickActionStatus } from "./useCalendarEventQuickActionMutations";
import useCalendarEventQuickActionMutations, {
  type QuickActionExternalHandlers,
  type QuickActionScope,
} from "./useCalendarEventQuickActionMutations";
export interface QuickActionPosition { top: number; left: number }

export interface QuickActionPrompt {
  kind: "reschedule" | "delete" | "color";
  event: CalendarQuickActionEvent;
  targetDate?: string;
  colorId?: string | number | null;
  position: QuickActionPosition;
  selectedScope: CalendarRecurrenceScope;
  confirming: boolean;
  error: string | null;
}

export interface QuickActionContextMenu {
  event: CalendarQuickActionEvent;
  actionScope?: QuickActionScope;
  x: number;
  y: number;
  confirm: boolean;
  busy: boolean;
  error: string | null;
  pendingColorId?: string | number | null;
}

export interface CalendarQuickActionsOptions extends QuickActionExternalHandlers {
  editable?: boolean;
  layout?: unknown;
}

export interface ContextMenuItemLike {
  sourceEvent?: CalendarQuickActionEvent;
  sourceItem?: CalendarQuickActionEvent;
}

function quickActionErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function promptPositionFromRect(rect: Partial<DOMRect> | null | undefined) {
  if (!rect || typeof window === "undefined") return { top: 96, left: 96 };
  const width = 340;
  const padding = 16;
  const left = Math.min(
    Math.max(padding, rect.left ?? 0),
    Math.max(padding, window.innerWidth - width - padding),
  );
  const top = Math.min(
    Math.max(padding, (rect.bottom ?? rect.top ?? 0) + 8),
    Math.max(padding, window.innerHeight - 220),
  );
  return { top, left };
}

export default function useCalendarQuickActions({
  editable = false,
  layout,
  upsertEvents,
  removeEvent,
  refreshRange,
  markStale,
  onSelectEvent,
  onReconcileSelection,
  onEventDeleted,
  onBatchDeleted,
  onCopyEvent,
  resolveEventActionScope,
}: CalendarQuickActionsOptions) {
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<QuickActionPrompt | null>(null);
  const [contextMenu, setContextMenu] = useState<QuickActionContextMenu | null>(null);
  const dragEnabled = editable && nativeDragSupported(layout);

  const {
    status,
    clearStatus,
    externalHandlersRef,
    runReschedule,
    runDelete,
    runBatchDelete,
    runClone,
    runClipboardPaste,
    runColorUpdate,
    runScopedColorUpdate,
  } = useCalendarEventQuickActionMutations({
    editable,
    handlers: {
      upsertEvents,
      removeEvent,
      refreshRange,
      markStale,
      onSelectEvent,
      onReconcileSelection,
      onEventDeleted,
      onBatchDeleted,
      onCopyEvent,
      resolveEventActionScope,
    },
  });

  const beginDrag = useCallback((event: CalendarQuickActionEvent) => {
    if (!dragEnabled || !event?.writable) return false;
    setDraggingEventId(eventSelectionId(event));
    setContextMenu(null);
    setPrompt(null);
    clearStatus();
    return true;
  }, [clearStatus, dragEnabled]);

  const endDrag = useCallback(() => {
    setDraggingEventId(null);
    setDropTargetDate(null);
  }, []);

  const enterDropTarget = useCallback((dateKey: string) => {
    if (!draggingEventId) return;
    setDropTargetDate(dateKey);
  }, [draggingEventId]);

  const leaveDropTarget = useCallback((dateKey: string) => {
    setDropTargetDate((current) => (current === dateKey ? null : current));
  }, []);

  const dropEvent = useCallback(async ({ event, targetDate, anchorRect }: {
    event: CalendarQuickActionEvent;
    targetDate: string;
    anchorRect?: Partial<DOMRect> | null;
  }) => {
    setDropTargetDate(null);
    setDraggingEventId(null);
    if (!dragEnabled || !event?.writable || !targetDate) return;
    if (pacificYMD(event.startMs) === targetDate) return;

    if (event.isRecurring) {
      setPrompt({
        kind: "reschedule",
        event,
        targetDate,
        position: promptPositionFromRect(anchorRect),
        selectedScope: "one",
        confirming: false,
        error: null,
      });
      return;
    }

    await runReschedule({ event, targetDate });
  }, [dragEnabled, runReschedule]);

  const openContextMenu = useCallback(({ event, item, x, y }: {
    event?: CalendarQuickActionEvent | null;
    item?: ContextMenuItemLike | null;
    x: number;
    y: number;
  }) => {
    const sourceEvent = event || item?.sourceEvent || (item?.sourceItem?.startMs ? item.sourceItem : null);
    if (!editable || !sourceEvent?.writable) return false;
    const resolvedScope = externalHandlersRef.current.resolveEventActionScope?.(sourceEvent);
    const actionScope: QuickActionScope = resolvedScope?.events?.length
      ? resolvedScope
      : { kind: "single", events: [sourceEvent], identities: [] };
    setPrompt(null);
    clearStatus();
    setContextMenu({
      event: sourceEvent,
      actionScope,
      x,
      y,
      confirm: false,
      busy: false,
      error: null,
      pendingColorId: null,
    });
    return true;
  }, [clearStatus, editable, externalHandlersRef]);

  const openDeleteMenu = useCallback(({ event, x, y }: {
    event: CalendarQuickActionEvent;
    x: number;
    y: number;
  }) => {
    if (!editable || !event?.writable) return;
    setPrompt(null);
    clearStatus();
    setContextMenu({
      event,
      x,
      y,
      confirm: false,
      busy: false,
      error: null,
    });
  }, [clearStatus, editable]);

  const requestBatchDelete = useCallback(({ events, x, y }: {
    events?: CalendarQuickActionEvent[];
    x?: number;
    y?: number;
  } = {}) => {
    const scopedEvents = (Array.isArray(events) ? events : []).filter((event) => event?.writable);
    if (!editable || !scopedEvents.length) return false;
    setPrompt(null);
    clearStatus();
    setContextMenu({
      event: scopedEvents[0]!,
      actionScope: {
        kind: "selection",
        events: scopedEvents.map((event) => ({ ...event })),
        identities: [],
      },
      x: Number.isFinite(Number(x)) ? Number(x) : (typeof window === "undefined" ? 96 : Math.max(96, window.innerWidth / 2 - 110)),
      y: Number.isFinite(Number(y)) ? Number(y) : (typeof window === "undefined" ? 96 : Math.max(96, window.innerHeight / 2 - 110)),
      confirm: true,
      busy: false,
      error: null,
      pendingColorId: null,
    });
    return true;
  }, [clearStatus, editable]);

  const copyContextEvent = useCallback(() => {
    const { onCopyEvent } = externalHandlersRef.current;
    const event = contextMenu?.event;
    const scopedEvents = contextMenu?.actionScope?.kind === "selection"
      ? contextMenu.actionScope.events
      : null;
    if (scopedEvents?.length) {
      onCopyEvent?.(scopedEvents);
    } else if (event) {
      onCopyEvent?.(event);
    }
    setContextMenu(null);
  }, [contextMenu?.actionScope, contextMenu?.event, externalHandlersRef]);

  const duplicateContextEvent = useCallback(() => {
    const event = contextMenu?.event;
    setContextMenu(null);
    if (event) runClone({ event });
  }, [contextMenu?.event, runClone]);

  const requestDelete = useCallback(() => {
    setContextMenu((current) => {
      if (!current) return current;
      if (current.actionScope?.kind === "selection" && current.actionScope.events?.length) {
        return { ...current, confirm: true, error: null };
      }
      if (current.event?.isRecurring) {
        setPrompt({
          kind: "delete",
          event: current.event,
          position: promptPositionFromRect({ left: current.x, top: current.y, bottom: current.y }),
          selectedScope: "one",
          confirming: false,
          error: null,
        });
        return null;
      }
      return { ...current, confirm: true, error: null };
    });
  }, []);

  const confirmContextDelete = useCallback(async () => {
    const event = contextMenu?.event;
    if (!event) return;
    const scopedEvents = contextMenu?.actionScope?.kind === "selection"
      ? contextMenu.actionScope.events
      : null;
    setContextMenu((current) => (current ? { ...current, busy: true, error: null } : current));
    try {
      if (scopedEvents?.length) {
        const { succeeded, failed } = await runBatchDelete({ events: scopedEvents });
        // Prune only the events that actually deleted. Surface a partial-failure
        // error and keep the menu open when some deletes failed, so the user can
        // retry the survivors instead of being left with a stale selection that
        // silently referenced already-deleted events.
        if (succeeded.length) {
          externalHandlersRef.current.onBatchDeleted?.(succeeded.map((entry) => entry.event));
        }
        if (failed.length) {
          const message = succeeded.length
            ? `Deleted ${succeeded.length}, failed ${failed.length}.`
            : quickActionErrorMessage(failed[0]?.error, "Failed to delete events.");
          setContextMenu((current) => (current ? { ...current, busy: false, error: message } : current));
          return;
        }
      } else {
        await runDelete({ event });
      }
      setContextMenu(null);
    } catch (err) {
      setContextMenu((current) => (current ? {
        ...current,
        busy: false,
        error: quickActionErrorMessage(err, "Failed to delete event."),
      } : current));
    }
  }, [contextMenu?.actionScope, contextMenu?.event, externalHandlersRef, runBatchDelete, runDelete]);

  const chooseEventColor = useCallback((colorId: string | number | null) => {
    const event = contextMenu?.event;
    if (!event || !colorId) return;
    const scopedEvents = contextMenu?.actionScope?.kind === "selection"
      ? contextMenu.actionScope.events
      : null;
    if (scopedEvents?.length) {
      setContextMenu(null);
      runScopedColorUpdate({ events: scopedEvents, colorId });
      return;
    }
    if (event.isRecurring) {
      setPrompt({
        kind: "color",
        event,
        colorId,
        position: promptPositionFromRect({ left: contextMenu.x, top: contextMenu.y, bottom: contextMenu.y }),
        selectedScope: "one",
        confirming: false,
        error: null,
      });
      setContextMenu(null);
      return;
    }
    setContextMenu(null);
    runColorUpdate({ event, colorId });
  }, [contextMenu?.actionScope, contextMenu?.event, contextMenu?.x, contextMenu?.y, runColorUpdate, runScopedColorUpdate]);

  const setPromptScope = useCallback((scope: CalendarRecurrenceScope) => {
    setPrompt((current) => (current ? { ...current, selectedScope: scope, error: null } : current));
  }, []);

  const confirmPrompt = useCallback(async () => {
    if (!prompt?.event || !prompt.selectedScope) return;
    setPrompt((current) => (current ? { ...current, confirming: true, error: null } : current));
    try {
      if (prompt.kind === "delete") {
        await runDelete({ event: prompt.event, scope: prompt.selectedScope });
      } else if (prompt.kind === "color") {
        await runColorUpdate({
          event: prompt.event,
          colorId: prompt.colorId!,
          scope: prompt.selectedScope,
        });
      } else {
        await runReschedule({
          event: prompt.event,
          targetDate: prompt.targetDate!,
          scope: prompt.selectedScope,
        });
      }
      setPrompt(null);
    } catch (err) {
      setPrompt((current) => (current ? {
        ...current,
        confirming: false,
        error: quickActionErrorMessage(err, `Failed to ${current.kind === "delete" ? "delete" : current.kind === "color" ? "color" : "move"} event.`),
      } : current));
    }
  }, [prompt, runColorUpdate, runDelete, runReschedule]);

  const cancelPrompt = useCallback(() => setPrompt(null), []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const copyEvent = useCallback((source: CalendarQuickActionEvent | CalendarQuickActionEvent[]) => (
    externalHandlersRef.current.onCopyEvent?.(source)
  ), [externalHandlersRef]);

  return useMemo(() => ({
    dragEnabled,
    draggingEventId,
    dropTargetDate,
    prompt,
    contextMenu,
    status,
    clearStatus,
    beginDrag,
    endDrag,
    enterDropTarget,
    leaveDropTarget,
    dropEvent,
    openContextMenu,
    openDeleteMenu,
    copyEvent,
    copyContextEvent,
    duplicateContextEvent,
    pasteEvent: (event: CalendarQuickActionEvent | CalendarEventClipboard | null, targetDate: string | null) => (
      event && "kind" in event && event.kind === "calendar-event-clipboard"
        ? runClipboardPaste({ clipboard: event, targetDate })
        : event
          ? runClone({ event: event as CalendarQuickActionEvent, targetDate })
          : undefined
    ),
    requestDelete,
    requestBatchDelete,
    confirmContextDelete,
    chooseEventColor,
    setPromptScope,
    confirmPrompt,
    cancelPrompt,
    closeContextMenu,
  }), [
    beginDrag,
    cancelPrompt,
    clearStatus,
    closeContextMenu,
    confirmContextDelete,
    confirmPrompt,
    contextMenu,
    dragEnabled,
    draggingEventId,
    dropEvent,
    dropTargetDate,
    endDrag,
    enterDropTarget,
    leaveDropTarget,
    openContextMenu,
    openDeleteMenu,
    copyEvent,
    copyContextEvent,
    duplicateContextEvent,
    prompt,
    requestBatchDelete,
    requestDelete,
    runClipboardPaste,
    runClone,
    chooseEventColor,
    setPromptScope,
    status,
  ]);
}
