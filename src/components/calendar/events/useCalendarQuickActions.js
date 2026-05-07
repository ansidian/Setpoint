import { useCallback, useMemo, useState } from "react";
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "@/api";
import { googleEventColorForId } from "../../../../shared/calendar-event-colors.js";
import {
  addDaysYmd,
  daysBetweenYmd,
  pacificTime24,
  pacificYMD,
} from "../calendarDateUtils.js";

const DAY_MS = 86400000;
let optimisticCloneCounter = 0;

function eventSelectionId(event) {
  if (!event) return null;
  if (event.id == null) return null;
  if (event.originalStartTime) return `${event.id}::${event.originalStartTime}`;
  return String(event.id);
}

function eventBounds(event) {
  if (!event?.startMs) return null;
  const start = pacificYMD(event.startMs);
  const end = event.allDay ? addDaysYmd(pacificYMD(event.endMs), -1) : pacificYMD(event.endMs || event.startMs);
  return { start, end };
}

function mergeBounds(...boundsList) {
  const bounds = boundsList.filter(Boolean);
  if (!bounds.length) return null;
  let start = bounds[0].start;
  let end = bounds[0].end;
  for (const boundsEntry of bounds.slice(1)) {
    if (boundsEntry.start < start) start = boundsEntry.start;
    if (boundsEntry.end > end) end = boundsEntry.end;
  }
  return { start, end };
}

function shiftEventByDays(event, deltaDays) {
  return {
    ...event,
    startMs: Number.isFinite(event.startMs) ? event.startMs + deltaDays * DAY_MS : event.startMs,
    endMs: Number.isFinite(event.endMs) ? event.endMs + deltaDays * DAY_MS : event.endMs,
  };
}

function optimisticCloneId(event) {
  optimisticCloneCounter += 1;
  return `optimistic-calendar-copy-${event?.id || "event"}-${Date.now()}-${optimisticCloneCounter}`;
}

export function buildReschedulePayload(event, shiftedEvent, scope) {
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    title: event.title || "",
    allDay: !!event.allDay,
    startDate: pacificYMD(shiftedEvent.startMs),
    endDate: shiftedEvent.allDay
      ? addDaysYmd(pacificYMD(shiftedEvent.endMs), -1)
      : pacificYMD(shiftedEvent.endMs || shiftedEvent.startMs),
    startTime: event.allDay ? null : pacificTime24(event.startMs),
    endTime: event.allDay ? null : pacificTime24(event.endMs || event.startMs),
    location: event.location || "",
    description: event.description || "",
    etag: event.etag,
    scope: event.isRecurring ? scope : undefined,
    recurringEventId: event.isRecurring ? event.recurringEventId : undefined,
    originalStartTime: event.isRecurring ? event.originalStartTime : undefined,
  };
}

export function buildCloneEventPayload(event, targetDate = null) {
  const sourceDate = pacificYMD(event.startMs);
  const startDate = targetDate || sourceDate;
  const sourceEndDate = event.allDay
    ? addDaysYmd(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs || event.startMs);
  const endDate = addDaysYmd(startDate, daysBetweenYmd(sourceDate, sourceEndDate));
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    title: event.title || "",
    allDay: !!event.allDay,
    startDate,
    endDate,
    startTime: event.allDay ? null : pacificTime24(event.startMs),
    endTime: event.allDay ? null : pacificTime24(event.endMs || event.startMs),
    location: event.location || "",
    description: event.description || "",
    colorId: event.colorId || event.sourceColorId || undefined,
  };
}

export function buildOptimisticCloneEvent(event, targetDate = null) {
  const sourceDate = pacificYMD(event.startMs);
  const deltaDays = targetDate ? daysBetweenYmd(sourceDate, targetDate) : 0;
  const shiftedEvent = shiftEventByDays(event, deltaDays);
  const colorId = event.colorId || event.sourceColorId || null;
  return {
    ...shiftedEvent,
    id: optimisticCloneId(event),
    etag: null,
    htmlLink: null,
    openUrl: null,
    colorId,
    color: googleEventColorForId(colorId)?.hex || event.color,
    isRecurring: false,
    recurringEventId: null,
    originalStartTime: null,
    recurrence: null,
    passed: false,
  };
}

export function buildColorUpdatePayload(event, colorId, scope) {
  return {
    ...buildReschedulePayload(event, event, scope),
    colorId,
  };
}

function buildDeletePayload(event, scope) {
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    etag: event.etag,
    scope: event.isRecurring ? scope : undefined,
    recurringEventId: event.isRecurring ? event.recurringEventId : undefined,
    originalStartTime: event.isRecurring ? event.originalStartTime : undefined,
  };
}

function promptPositionFromRect(rect) {
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

function nativeDragSupported(layout) {
  if (layout?.stacked) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(pointer: fine)").matches;
}

export default function useCalendarQuickActions({
  editable = false,
  layout,
  upsertEvents,
  removeEvent,
  refreshRange,
  onSelectEvent,
  onEventDeleted,
  onCopyEvent,
}) {
  const [draggingEventId, setDraggingEventId] = useState(null);
  const [dropTargetDate, setDropTargetDate] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [status, setStatus] = useState(null);
  const dragEnabled = editable && nativeDragSupported(layout);

  const clearStatus = useCallback(() => setStatus(null), []);

  const runReschedule = useCallback(async ({ event, targetDate, scope }) => {
    const sourceDate = pacificYMD(event.startMs);
    const deltaDays = daysBetweenYmd(sourceDate, targetDate);
    if (!deltaDays) return;

    const shiftedEvent = shiftEventByDays(event, deltaDays);
    const originalBounds = eventBounds(event);
    const shiftedBounds = eventBounds(shiftedEvent);
    const changedBounds = mergeBounds(originalBounds, shiftedBounds);
    setStatus({ tone: "pending", message: "Moving event..." });
    upsertEvents?.(shiftedEvent);
    onSelectEvent?.(eventSelectionId(shiftedEvent), pacificYMD(shiftedEvent.startMs));

    try {
      const result = await updateCalendarEvent(event.id, buildReschedulePayload(event, shiftedEvent, scope));
      if (result?.event) upsertEvents?.(result.event);
      if (event.isRecurring && scope !== "one" && changedBounds) {
        await refreshRange?.(changedBounds.start, changedBounds.end);
      }
      setStatus({ tone: "success", message: "Event moved." });
      window.setTimeout(() => setStatus(null), 1800);
    } catch (err) {
      upsertEvents?.(event);
      setStatus({ tone: "error", message: err.message || "Failed to move event." });
      throw err;
    }
  }, [onSelectEvent, refreshRange, upsertEvents]);

  const runDelete = useCallback(async ({ event, scope }) => {
    const bounds = eventBounds(event);
    setStatus({ tone: "pending", message: "Deleting event..." });
    removeEvent?.(event.id);
    try {
      await deleteCalendarEvent(event.id, buildDeletePayload(event, scope));
      if (event.isRecurring && bounds) {
        await refreshRange?.(bounds.start, bounds.end);
      }
      onEventDeleted?.(eventSelectionId(event), event);
      setStatus({ tone: "success", message: "Event deleted." });
      window.setTimeout(() => setStatus(null), 1800);
    } catch (err) {
      upsertEvents?.(event);
      setStatus({ tone: "error", message: err.message || "Failed to delete event." });
      throw err;
    }
  }, [onEventDeleted, refreshRange, removeEvent, upsertEvents]);

  const runClone = useCallback(async ({ event, targetDate = null }) => {
    if (!editable || !event?.writable) return;
    const optimisticEvent = buildOptimisticCloneEvent(event, targetDate);
    upsertEvents?.(optimisticEvent);
    onSelectEvent?.(eventSelectionId(optimisticEvent), pacificYMD(optimisticEvent.startMs));
    try {
      const result = await createCalendarEvent(buildCloneEventPayload(event, targetDate));
      if (result?.event) {
        removeEvent?.(optimisticEvent.id);
        upsertEvents?.(result.event);
        onSelectEvent?.(eventSelectionId(result.event), pacificYMD(result.event.startMs));
      } else {
        removeEvent?.(optimisticEvent.id);
      }
    } catch {
      removeEvent?.(optimisticEvent.id);
      // Silent by design for this hidden power flow.
    }
  }, [editable, onSelectEvent, removeEvent, upsertEvents]);

  const runColorUpdate = useCallback(async ({ event, colorId, scope }) => {
    if (!editable || !event?.writable || !colorId) return;
    const color = googleEventColorForId(colorId)?.hex || event.color;
    const optimisticEvent = { ...event, colorId, color };
    upsertEvents?.(optimisticEvent);
    try {
      const result = await updateCalendarEvent(event.id, buildColorUpdatePayload(event, colorId, scope));
      if (result?.event) upsertEvents?.(result.event);
      if (event.isRecurring && scope !== "one") {
        const bounds = eventBounds(event);
        if (bounds) await refreshRange?.(bounds.start, bounds.end);
      }
    } catch {
      upsertEvents?.(event);
    }
  }, [editable, refreshRange, upsertEvents]);

  const beginDrag = useCallback((event) => {
    if (!dragEnabled || !event?.writable) return false;
    setDraggingEventId(eventSelectionId(event));
    setContextMenu(null);
    setPrompt(null);
    setStatus(null);
    return true;
  }, [dragEnabled]);

  const endDrag = useCallback(() => {
    setDraggingEventId(null);
    setDropTargetDate(null);
  }, []);

  const enterDropTarget = useCallback((dateKey) => {
    if (!draggingEventId) return;
    setDropTargetDate(dateKey);
  }, [draggingEventId]);

  const leaveDropTarget = useCallback((dateKey) => {
    setDropTargetDate((current) => (current === dateKey ? null : current));
  }, []);

  const dropEvent = useCallback(async ({ event, targetDate, anchorRect }) => {
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

  const openContextMenu = useCallback(({ event, item, x, y }) => {
    const sourceEvent = event || item?.sourceEvent || (item?.sourceItem?.startMs ? item.sourceItem : null);
    if (!editable || !sourceEvent?.writable) return false;
    setPrompt(null);
    setStatus(null);
    setContextMenu({
      event: sourceEvent,
      x,
      y,
      confirm: false,
      busy: false,
      error: null,
      pendingColorId: null,
    });
    return true;
  }, [editable]);

  const openDeleteMenu = useCallback(({ event, x, y }) => {
    if (!editable || !event?.writable) return;
    setPrompt(null);
    setStatus(null);
    setContextMenu({
      event,
      x,
      y,
      confirm: false,
      busy: false,
      error: null,
    });
  }, [editable]);

  const copyContextEvent = useCallback(() => {
    const event = contextMenu?.event;
    if (event) onCopyEvent?.(event);
    setContextMenu(null);
  }, [contextMenu?.event, onCopyEvent]);

  const duplicateContextEvent = useCallback(() => {
    const event = contextMenu?.event;
    setContextMenu(null);
    if (event) runClone({ event });
  }, [contextMenu?.event, runClone]);

  const requestDelete = useCallback(() => {
    setContextMenu((current) => {
      if (!current) return current;
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
    setContextMenu((current) => (current ? { ...current, busy: true, error: null } : current));
    try {
      await runDelete({ event });
      setContextMenu(null);
    } catch (err) {
      setContextMenu((current) => (current ? {
        ...current,
        busy: false,
        error: err.message || "Failed to delete event.",
      } : current));
    }
  }, [contextMenu?.event, runDelete]);

  const chooseEventColor = useCallback((colorId) => {
    const event = contextMenu?.event;
    if (!event || !colorId) return;
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
  }, [contextMenu?.event, contextMenu?.x, contextMenu?.y, runColorUpdate]);

  const setPromptScope = useCallback((scope) => {
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
          colorId: prompt.colorId,
          scope: prompt.selectedScope,
        });
      } else {
        await runReschedule({
          event: prompt.event,
          targetDate: prompt.targetDate,
          scope: prompt.selectedScope,
        });
      }
      setPrompt(null);
    } catch (err) {
      setPrompt((current) => (current ? {
        ...current,
        confirming: false,
        error: err.message || `Failed to ${current.kind === "delete" ? "delete" : current.kind === "color" ? "color" : "move"} event.`,
      } : current));
    }
  }, [prompt, runColorUpdate, runDelete, runReschedule]);

  const cancelPrompt = useCallback(() => setPrompt(null), []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

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
    copyEvent: onCopyEvent,
    copyContextEvent,
    duplicateContextEvent,
    pasteEvent: (event, targetDate) => runClone({ event, targetDate }),
    requestDelete,
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
    copyContextEvent,
    duplicateContextEvent,
    onCopyEvent,
    prompt,
    requestDelete,
    runClone,
    chooseEventColor,
    setPromptScope,
    status,
  ]);
}
