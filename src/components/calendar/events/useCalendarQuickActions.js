import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCalendarEvent, createCalendarEventsBatch, deleteCalendarEvent, updateCalendarEvent } from "@/api";
import { googleEventColorForId } from "../../../../shared/calendar-event-colors.js";
import {
  addDaysYmd,
  daysBetweenYmd,
  pacificTime24,
  pacificYMD,
  parseYmd,
} from "../calendarDateUtils.js";
import { epochFromLa } from "../../inbox/helpers.js";
import { planCalendarEventClipboardPaste } from "./calendarEventSelectionModel.js";

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

function isOptimisticCloneEvent(event) {
  return event?._optimisticCalendarClone === true
    || (typeof event?.id === "string" && event.id.startsWith("optimistic-calendar-copy-"));
}

export function buildReschedulePayload(event, deltaDays = 0, scope) {
  // Derive the new dates by calendar-day arithmetic from the source YMD rather
  // than by re-reading pacificYMD of a fixed-ms (event.startMs + deltaDays*DAY_MS)
  // shift. A fixed 86_400_000ms/day shift crosses a DST boundary off by an hour,
  // so a late-evening event dragged across spring-forward lands on the wrong
  // calendar day. This mirrors the DST-safe approach in buildCloneEventPayload.
  const sourceStartDate = pacificYMD(event.startMs);
  const sourceEndDate = event.allDay
    ? addDaysYmd(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs || event.startMs);
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    title: event.title || "",
    allDay: !!event.allDay,
    startDate: addDaysYmd(sourceStartDate, deltaDays),
    endDate: addDaysYmd(sourceEndDate, deltaDays),
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
    _optimisticCalendarClone: true,
  };
}

function payloadDateTimeMs(date, time, { allDay = false, end = false } = {}) {
  const datePart = allDay && end ? addDaysYmd(date, 1) : date;
  const timePart = allDay ? "00:00" : time || "00:00";
  // Build the optimistic epoch from Pacific wall-clock components so it matches
  // the server (which interprets the same date/time strings in Pacific). The
  // prior `new Date("YYYY-MM-DDTHH:mm:00")` parsed offsetless strings in the
  // browser's local zone, so a non-Pacific session placed the optimistic event
  // hours off until the server result reconciled it.
  const parsedDate = parseYmd(datePart);
  if (!parsedDate) return Date.now();
  const [hourStr, minuteStr] = String(timePart).split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Date.now();
  return epochFromLa(parsedDate.year, parsedDate.month, parsedDate.day, hour, minute);
}

export function buildOptimisticClipboardPasteEvent(item, index = 0) {
  const colorId = item.colorId || null;
  return {
    id: optimisticCloneId({ id: `clipboard-${index}` }),
    title: item.title || "",
    accountId: item.accountId,
    calendarId: item.calendarId,
    startMs: payloadDateTimeMs(item.startDate, item.startTime, { allDay: !!item.allDay }),
    endMs: payloadDateTimeMs(item.endDate || item.startDate, item.endTime, {
      allDay: !!item.allDay,
      end: true,
    }),
    allDay: !!item.allDay,
    location: item.location || "",
    description: item.description || "",
    colorId,
    color: googleEventColorForId(colorId)?.hex || undefined,
    writable: true,
    etag: null,
    htmlLink: null,
    openUrl: null,
    isRecurring: false,
    recurringEventId: null,
    originalStartTime: null,
    recurrence: null,
    passed: false,
    _optimisticCalendarClone: true,
  };
}

export function buildColorUpdatePayload(event, colorId, scope) {
  return {
    // A color change keeps the event on its current days, so deltaDays = 0.
    ...buildReschedulePayload(event, 0, scope),
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
  onBatchDeleted,
  onCopyEvent,
  resolveEventActionScope,
}) {
  const [draggingEventId, setDraggingEventId] = useState(null);
  const [dropTargetDate, setDropTargetDate] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [status, setStatus] = useState(null);
  const optimisticCloneRequestsRef = useRef(new Map());
  const dragEnabled = editable && nativeDragSupported(layout);

  // Callers pass these handlers as inline closures; reading them through a
  // ref keeps every action identity (and the returned object) stable across
  // parent re-renders, so memoized month grids holding these actions do not
  // re-render whenever the controller does.
  const externalHandlersRef = useRef(null);
  useEffect(() => {
    externalHandlersRef.current = {
      upsertEvents,
      removeEvent,
      refreshRange,
      onSelectEvent,
      onEventDeleted,
      onBatchDeleted,
      onCopyEvent,
      resolveEventActionScope,
    };
  });

  const clearStatus = useCallback(() => setStatus(null), []);

  const runReschedule = useCallback(async ({ event, targetDate, scope }) => {
    const { upsertEvents, refreshRange, onSelectEvent } = externalHandlersRef.current;
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
      const result = await updateCalendarEvent(event.id, buildReschedulePayload(event, deltaDays, scope));
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
  }, []);

  const runDelete = useCallback(async ({ event, scope }) => {
    const { upsertEvents, removeEvent, refreshRange, onEventDeleted } = externalHandlersRef.current;
    if (isOptimisticCloneEvent(event)) {
      const optimisticId = String(event.id);
      const cloneRequest = optimisticCloneRequestsRef.current.get(optimisticId);
      if (cloneRequest) cloneRequest.deleted = true;
      const createdEvent = cloneRequest?.createdEvent || null;
      const deletionEvent = createdEvent || event;
      setStatus({ tone: "pending", message: "Deleting event..." });
      removeEvent?.(optimisticId);
      if (createdEvent?.id) removeEvent?.(createdEvent.id);
      onEventDeleted?.(eventSelectionId(deletionEvent), deletionEvent);

      if (createdEvent?.id) {
        try {
          await deleteCalendarEvent(createdEvent.id, buildDeletePayload(createdEvent));
          optimisticCloneRequestsRef.current.delete(optimisticId);
          setStatus({ tone: "success", message: "Event deleted." });
          window.setTimeout(() => setStatus(null), 1800);
        } catch (err) {
          upsertEvents?.(createdEvent);
          setStatus({ tone: "error", message: err.message || "Failed to delete event." });
          throw err;
        }
        return;
      }

      if (!cloneRequest) {
        setStatus({ tone: "success", message: "Event deleted." });
        window.setTimeout(() => setStatus(null), 1800);
      }
      return;
    }

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
  }, []);

  const runBatchDelete = useCallback(async ({ events }) => {
    const scopedEvents = Array.isArray(events) ? events : [];
    const succeeded = [];
    const failed = [];
    if (!scopedEvents.length) return { succeeded, failed };
    // Collect per-event outcomes instead of throwing on the first failure.
    // Throwing aborted the loop, leaving the still-undeleted tail of events in
    // a half-applied state and the whole selection set cleared by the caller —
    // i.e. selection that still referenced live events was dropped while a
    // failed event silently survived. Now we attempt every event and report
    // which identities actually deleted so the caller can prune precisely.
    for (const event of scopedEvents) {
      try {
        await runDelete({
          event,
          scope: event?.isRecurring ? "one" : undefined,
        });
        succeeded.push({ event, identity: eventSelectionId(event) });
      } catch (err) {
        failed.push({ event, identity: eventSelectionId(event), error: err });
      }
    }
    return { succeeded, failed };
  }, [runDelete]);

  const runClone = useCallback(async ({ event, targetDate = null }) => {
    const { upsertEvents, removeEvent, onSelectEvent } = externalHandlersRef.current;
    if (!editable || !event?.writable) return;
    const optimisticEvent = buildOptimisticCloneEvent(event, targetDate);
    const optimisticId = String(optimisticEvent.id);
    const cloneRequest = {
      createdEvent: null,
      deleted: false,
    };
    optimisticCloneRequestsRef.current.set(optimisticId, cloneRequest);
    upsertEvents?.(optimisticEvent);
    onSelectEvent?.(eventSelectionId(optimisticEvent), pacificYMD(optimisticEvent.startMs));
    try {
      const result = await createCalendarEvent(buildCloneEventPayload(event, targetDate));
      if (result?.event) {
        cloneRequest.createdEvent = result.event;
        if (cloneRequest.deleted) {
          removeEvent?.(optimisticId);
          try {
            await deleteCalendarEvent(result.event.id, buildDeletePayload(result.event));
            optimisticCloneRequestsRef.current.delete(optimisticId);
            setStatus({ tone: "success", message: "Event deleted." });
            window.setTimeout(() => setStatus(null), 1800);
          } catch (err) {
            upsertEvents?.(result.event);
            setStatus({ tone: "error", message: err.message || "Failed to delete event." });
          }
          return;
        }
        removeEvent?.(optimisticEvent.id);
        upsertEvents?.(result.event);
        onSelectEvent?.(eventSelectionId(result.event), pacificYMD(result.event.startMs));
        window.setTimeout(() => {
          const current = optimisticCloneRequestsRef.current.get(optimisticId);
          if (current === cloneRequest && !current.deleted) {
            optimisticCloneRequestsRef.current.delete(optimisticId);
          }
        }, 30000);
      } else {
        removeEvent?.(optimisticEvent.id);
        optimisticCloneRequestsRef.current.delete(optimisticId);
        if (cloneRequest.deleted) {
          setStatus({ tone: "success", message: "Event deleted." });
          window.setTimeout(() => setStatus(null), 1800);
        }
      }
    } catch {
      removeEvent?.(optimisticEvent.id);
      optimisticCloneRequestsRef.current.delete(optimisticId);
      if (cloneRequest.deleted) {
        setStatus({ tone: "success", message: "Event deleted." });
        window.setTimeout(() => setStatus(null), 1800);
      }
      // Silent by design for this hidden power flow.
    }
  }, [editable]);

  const runClipboardPaste = useCallback(async ({ clipboard, targetDate = null }) => {
    const { upsertEvents, removeEvent, onSelectEvent } = externalHandlersRef.current;
    if (!editable || !targetDate) return false;
    const plan = planCalendarEventClipboardPaste(clipboard, targetDate);
    if (!plan?.items?.length) return false;

    const optimisticEvents = plan.items.map((item, index) => buildOptimisticClipboardPasteEvent(item, index));
    for (const event of optimisticEvents) {
      upsertEvents?.(event);
    }
    const firstOptimistic = optimisticEvents[0];
    if (firstOptimistic) {
      onSelectEvent?.(eventSelectionId(firstOptimistic), pacificYMD(firstOptimistic.startMs));
    }

    if (plan.items.length === 1) {
      const optimisticEvent = optimisticEvents[0];
      try {
        const result = await createCalendarEvent(plan.items[0]);
        removeEvent?.(optimisticEvent.id);
        if (result?.event) {
          upsertEvents?.(result.event);
          onSelectEvent?.(eventSelectionId(result.event), pacificYMD(result.event.startMs));
        }
      } catch {
        // Surface paste failure instead of silently rolling back the optimistic
        // row, matching the reschedule/delete error UX.
        removeEvent?.(optimisticEvent.id);
        setStatus({ tone: "error", message: "Failed to paste event." });
      }
      return true;
    }

    try {
      const result = await createCalendarEventsBatch(plan.items);
      const createdByIndex = new Map((result?.created || [])
        .filter((entry) => Number.isInteger(entry?.index) && entry?.event)
        .map((entry) => [entry.index, entry.event]));
      const failedIndexes = new Set((result?.failed || [])
        .filter((entry) => Number.isInteger(entry?.index))
        .map((entry) => entry.index));

      for (let index = 0; index < optimisticEvents.length; index += 1) {
        const optimisticEvent = optimisticEvents[index];
        const createdEvent = createdByIndex.get(index);
        if (createdEvent) {
          removeEvent?.(optimisticEvent.id);
          upsertEvents?.(createdEvent);
          continue;
        }
        if (failedIndexes.has(index) || !createdByIndex.has(index)) {
          removeEvent?.(optimisticEvent.id);
        }
      }

      const firstCreated = [...createdByIndex.entries()]
        .sort(([a], [b]) => a - b)[0]?.[1];
      if (firstCreated) {
        onSelectEvent?.(eventSelectionId(firstCreated), pacificYMD(firstCreated.startMs));
      }
      // A partially-rejected batch was previously silent: failed rows vanished
      // with no feedback. Report the failure count when any item did not paste.
      const failedCount = optimisticEvents.length - createdByIndex.size;
      if (failedCount > 0) {
        setStatus({
          tone: "error",
          message: createdByIndex.size
            ? `Pasted ${createdByIndex.size}, failed ${failedCount}.`
            : "Failed to paste event.",
        });
      }
    } catch {
      // Surface paste failure instead of silently rolling back optimistic rows.
      for (const event of optimisticEvents) {
        removeEvent?.(event.id);
      }
      setStatus({ tone: "error", message: "Failed to paste event." });
    }
    return true;
  }, [editable]);

  const runColorUpdate = useCallback(async ({ event, colorId, scope }) => {
    const { upsertEvents, refreshRange } = externalHandlersRef.current;
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
  }, [editable]);

  const runScopedColorUpdate = useCallback(async ({ events, colorId }) => {
    const scopedEvents = Array.isArray(events) ? events : [];
    if (!scopedEvents.length || !colorId) return;
    await Promise.all(scopedEvents.map((event) => runColorUpdate({
      event,
      colorId,
      scope: event?.isRecurring ? "one" : undefined,
    })));
  }, [runColorUpdate]);

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
    const resolvedScope = externalHandlersRef.current.resolveEventActionScope?.(sourceEvent);
    const actionScope = resolvedScope?.events?.length
      ? resolvedScope
      : { kind: "single", events: [sourceEvent], identities: [] };
    setPrompt(null);
    setStatus(null);
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

  const requestBatchDelete = useCallback(({ events, x, y } = {}) => {
    const scopedEvents = (Array.isArray(events) ? events : []).filter((event) => event?.writable);
    if (!editable || !scopedEvents.length) return false;
    setPrompt(null);
    setStatus(null);
    setContextMenu({
      event: scopedEvents[0],
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
  }, [editable]);

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
  }, [contextMenu?.actionScope, contextMenu?.event]);

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
            : (failed[0]?.error?.message || "Failed to delete events.");
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
        error: err.message || "Failed to delete event.",
      } : current));
    }
  }, [contextMenu?.actionScope, contextMenu?.event, runBatchDelete, runDelete]);

  const chooseEventColor = useCallback((colorId) => {
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
  const copyEvent = useCallback((...args) => externalHandlersRef.current.onCopyEvent?.(...args), []);

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
    pasteEvent: (event, targetDate) => (
      event?.kind === "calendar-event-clipboard"
        ? runClipboardPaste({ clipboard: event, targetDate })
        : runClone({ event, targetDate })
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
