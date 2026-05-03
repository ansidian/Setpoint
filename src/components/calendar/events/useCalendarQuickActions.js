import { useCallback, useMemo, useState } from "react";
import { deleteCalendarEvent, updateCalendarEvent } from "@/api";
import {
  addDaysYmd,
  daysBetweenYmd,
  pacificTime24,
  pacificYMD,
} from "../calendarDateUtils.js";

const DAY_MS = 86400000;

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

  const setPromptScope = useCallback((scope) => {
    setPrompt((current) => (current ? { ...current, selectedScope: scope, error: null } : current));
  }, []);

  const confirmPrompt = useCallback(async () => {
    if (!prompt?.event || !prompt.selectedScope) return;
    setPrompt((current) => (current ? { ...current, confirming: true, error: null } : current));
    try {
      if (prompt.kind === "delete") {
        await runDelete({ event: prompt.event, scope: prompt.selectedScope });
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
        error: err.message || `Failed to ${current.kind === "delete" ? "delete" : "move"} event.`,
      } : current));
    }
  }, [prompt, runDelete, runReschedule]);

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
    openDeleteMenu,
    requestDelete,
    confirmContextDelete,
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
    openDeleteMenu,
    prompt,
    requestDelete,
    setPromptScope,
    status,
  ]);
}
