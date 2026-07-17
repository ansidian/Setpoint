import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCalendarEvent, createCalendarEventsBatch, deleteCalendarEvent, updateCalendarEvent } from "@/api";
import { googleEventColorForId } from "../../../../shared/calendar-event-colors";
import { daysBetweenYmd, pacificYMD } from "../calendarDateUtils.ts";
import { planCalendarEventClipboardPaste } from "./calendarEventSelectionModel";
import {
  buildCloneEventPayload,
  buildColorUpdatePayload,
  buildDeletePayload,
  buildOptimisticCloneEvent,
  buildOptimisticClipboardPasteEvent,
  buildReschedulePayload,
  eventBounds,
  eventSelectionId,
  isOptimisticCloneEvent,
  mergeBounds,
  shiftEventByDays,
} from "./calendarQuickActionModel";
import { nativeDragSupported } from "../calendarDragSupport.ts";
import type {
  CalendarEventClipboard,
} from "./calendarEventSelectionModel";
import type {
  CalendarQuickActionBounds,
  CalendarQuickActionEvent,
} from "./calendarQuickActionModel";
import type { CalendarRecurrenceScope, NormalizedCalendarEvent } from "../../../../shared/types/calendar";

export interface QuickActionStatus { tone: "pending" | "success" | "error"; message: string }
export interface QuickActionPosition { top: number; left: number }

export interface QuickActionScope {
  kind: "none" | "single" | "selection";
  events: CalendarQuickActionEvent[];
  identities: Array<string | null>;
}

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

interface OptimisticCloneRequest {
  createdEvent: NormalizedCalendarEvent | null;
  deleted: boolean;
}

interface QuickActionExternalHandlers {
  upsertEvents?: (events: CalendarQuickActionEvent | NormalizedCalendarEvent | Array<CalendarQuickActionEvent | NormalizedCalendarEvent>) => void;
  removeEvent?: (eventId: string | number | null | undefined) => void;
  refreshRange?: (start: string, end: string) => Promise<unknown> | unknown;
  markStale?: (start: string, end: string) => void;
  onSelectEvent?: (eventId: string | null, date: string) => void;
  onReconcileSelection?: (previousId: string | null, nextId: string | null) => void;
  onEventDeleted?: (eventId: string | null, event: CalendarQuickActionEvent) => void;
  onBatchDeleted?: (events: CalendarQuickActionEvent[]) => void;
  onCopyEvent?: (source: CalendarQuickActionEvent | CalendarQuickActionEvent[]) => void;
  resolveEventActionScope?: (event: CalendarQuickActionEvent) => QuickActionScope | null | undefined;
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
  const [status, setStatus] = useState<QuickActionStatus | null>(null);
  const optimisticCloneRequestsRef = useRef(new Map<string, OptimisticCloneRequest>());
  const dragEnabled = editable && nativeDragSupported(layout);

  // Callers pass these handlers as inline closures; reading them through a
  // ref keeps every action identity (and the returned object) stable across
  // parent re-renders, so memoized month grids holding these actions do not
  // re-render whenever the controller does.
  const externalHandlersRef = useRef<QuickActionExternalHandlers>({});
  useEffect(() => {
    externalHandlersRef.current = {
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
    };
  });

  const clearStatus = useCallback(() => setStatus(null), []);

  // Self-heal after a settled mutation FAILURE: once we have reverted the
  // optimistic state, mark the touched months stale so the next range pass
  // re-fetches truth from Google. This closes the residual-divergence window
  // where a request timed out (or otherwise rejected) AFTER the server had
  // actually applied it — the revert alone would leave the grid wrong until the
  // month cache TTL expired. Bounds are the event's (or merged) YMD span.
  const markMonthsStale = useCallback((bounds: CalendarQuickActionBounds | null | undefined) => {
    const { markStale } = externalHandlersRef.current;
    if (bounds?.start && bounds?.end) markStale?.(bounds.start, bounds.end);
  }, []);

  const runReschedule = useCallback(async ({ event, targetDate, scope }: {
    event: CalendarQuickActionEvent;
    targetDate: string;
    scope?: CalendarRecurrenceScope;
  }) => {
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
      markMonthsStale(changedBounds || originalBounds);
      setStatus({ tone: "error", message: quickActionErrorMessage(err, "Failed to move event.") });
      throw err;
    }
  }, [markMonthsStale]);

  const runDelete = useCallback(async ({ event, scope }: {
    event: CalendarQuickActionEvent;
    scope?: CalendarRecurrenceScope;
  }) => {
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
          markMonthsStale(eventBounds(createdEvent));
          setStatus({ tone: "error", message: quickActionErrorMessage(err, "Failed to delete event.") });
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
      markMonthsStale(bounds);
      setStatus({ tone: "error", message: quickActionErrorMessage(err, "Failed to delete event.") });
      throw err;
    }
  }, [markMonthsStale]);

  const runBatchDelete = useCallback(async ({ events }: { events: CalendarQuickActionEvent[] }) => {
    const scopedEvents = Array.isArray(events) ? events : [];
    const succeeded: Array<{ event: CalendarQuickActionEvent; identity: string | null }> = [];
    const failed: Array<{ event: CalendarQuickActionEvent; identity: string | null; error: unknown }> = [];
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

  // Reconcile one optimistic clone/paste row against its server create result,
  // owning the delete-during-create race. Shared by runClone and both clipboard-
  // paste paths so a row deleted while its create was in flight is handled
  // identically everywhere: instead of resurrecting the now-created event, we
  // delete it on Google. Returns the live server event when the row settled as a
  // normal create (so the caller can reconcile selection), or null when the row
  // was cancelled/deleted or the server created nothing.
  const settleOptimisticCreate = useCallback(async (
    optimisticId: string,
    createdEvent: NormalizedCalendarEvent | null,
  ) => {
    const { upsertEvents, removeEvent } = externalHandlersRef.current;
    const cloneRequest = optimisticCloneRequestsRef.current.get(optimisticId);
    if (!createdEvent) {
      // The server returned no event — drop the optimistic row and its tracking.
      removeEvent?.(optimisticId);
      optimisticCloneRequestsRef.current.delete(optimisticId);
      if (cloneRequest?.deleted) {
        setStatus({ tone: "success", message: "Event deleted." });
        window.setTimeout(() => setStatus(null), 1800);
      }
      return null;
    }
    if (cloneRequest) cloneRequest.createdEvent = createdEvent;
    if (cloneRequest?.deleted) {
      // Deleted mid-flight: the create still landed on Google, so delete it there
      // rather than leaving a ghost the user already dismissed in the grid.
      removeEvent?.(optimisticId);
      try {
        await deleteCalendarEvent(createdEvent.id, buildDeletePayload(createdEvent));
        optimisticCloneRequestsRef.current.delete(optimisticId);
        setStatus({ tone: "success", message: "Event deleted." });
        window.setTimeout(() => setStatus(null), 1800);
      } catch (err) {
        upsertEvents?.(createdEvent);
        markMonthsStale(eventBounds(createdEvent));
        setStatus({ tone: "error", message: quickActionErrorMessage(err, "Failed to delete event.") });
      }
      return null;
    }
    // Live: swap the optimistic row for the real event and GC the tracking entry
    // after 30s (long enough for a just-after delete to still find createdEvent).
    removeEvent?.(optimisticId);
    upsertEvents?.(createdEvent);
    if (cloneRequest) {
      window.setTimeout(() => {
        const current = optimisticCloneRequestsRef.current.get(optimisticId);
        if (current === cloneRequest && !current.deleted) {
          optimisticCloneRequestsRef.current.delete(optimisticId);
        }
      }, 30000);
    }
    return createdEvent;
  }, [markMonthsStale]);

  const runClone = useCallback(async ({ event, targetDate = null }: {
    event: CalendarQuickActionEvent;
    targetDate?: string | null;
  }) => {
    const { upsertEvents, onSelectEvent, onReconcileSelection } = externalHandlersRef.current;
    if (!editable || !event?.writable) return;
    const optimisticEvent = buildOptimisticCloneEvent(event, targetDate);
    const optimisticId = String(optimisticEvent.id);
    optimisticCloneRequestsRef.current.set(optimisticId, { createdEvent: null, deleted: false });
    upsertEvents?.(optimisticEvent);
    onSelectEvent?.(eventSelectionId(optimisticEvent), pacificYMD(optimisticEvent.startMs));
    try {
      const result = await createCalendarEvent(buildCloneEventPayload(event, targetDate));
      const created = await settleOptimisticCreate(optimisticId, result?.event || null);
      // Reconcile the selected id without re-asserting the day: a delayed
      // day-move would yank the user's selection back here if they have since
      // navigated to the next paste/clone target.
      if (created) {
        onReconcileSelection?.(eventSelectionId(optimisticEvent), eventSelectionId(created));
      }
    } catch {
      await settleOptimisticCreate(optimisticId, null);
      // Silent by design for this hidden power flow.
    }
  }, [editable, settleOptimisticCreate]);

  const runClipboardPaste = useCallback(async ({ clipboard, targetDate = null }: {
    clipboard: CalendarEventClipboard;
    targetDate?: string | null;
  }) => {
    const { upsertEvents, removeEvent, onSelectEvent, onReconcileSelection } = externalHandlersRef.current;
    if (!editable || !targetDate) return false;
    const plan = planCalendarEventClipboardPaste(clipboard, targetDate);
    if (!plan?.items?.length) return false;

    const optimisticEvents = plan.items.map((item, index) => buildOptimisticClipboardPasteEvent(item, index));
    for (const event of optimisticEvents) {
      // Track every paste row so deleting it mid-create reaches the server rather
      // than silently no-op'ing and resurrecting the event when the create lands.
      optimisticCloneRequestsRef.current.set(String(event.id), { createdEvent: null, deleted: false });
      upsertEvents?.(event);
    }
    const firstOptimistic = optimisticEvents[0];
    if (firstOptimistic) {
      onSelectEvent?.(eventSelectionId(firstOptimistic), pacificYMD(firstOptimistic.startMs));
    }

    if (plan.items.length === 1) {
      const optimisticEvent = optimisticEvents[0]!;
      const optimisticId = String(optimisticEvent.id);
      try {
        const result = await createCalendarEvent(plan.items[0]!);
        const created = await settleOptimisticCreate(optimisticId, result?.event || null);
        if (created) {
          onReconcileSelection?.(eventSelectionId(optimisticEvent), eventSelectionId(created));
        }
      } catch {
        // Surface paste failure instead of silently rolling back the optimistic
        // row, matching the reschedule/delete error UX.
        removeEvent?.(optimisticId);
        optimisticCloneRequestsRef.current.delete(optimisticId);
        markMonthsStale(eventBounds(optimisticEvent));
        setStatus({ tone: "error", message: "Failed to paste event." });
      }
      return true;
    }

    try {
      const result = await createCalendarEventsBatch(plan.items);
      const createdByIndex = new Map((result?.created || [])
        .filter((entry) => Number.isInteger(entry?.index) && entry?.event)
        .map((entry) => [entry.index, entry.event]));

      let firstLiveCreated: NormalizedCalendarEvent | null = null;
      for (let index = 0; index < optimisticEvents.length; index += 1) {
        const optimisticId = String(optimisticEvents[index]!.id);
        const createdEvent = createdByIndex.get(index) || null;
        const settled = await settleOptimisticCreate(optimisticId, createdEvent);
        if (settled && !firstLiveCreated) firstLiveCreated = settled;
      }

      if (firstLiveCreated) {
        onReconcileSelection?.(eventSelectionId(firstOptimistic), eventSelectionId(firstLiveCreated));
      }
      // A partially-rejected batch was previously silent: failed rows vanished
      // with no feedback. Report the failure count from what the server actually
      // created — rows deleted mid-flight WERE created, so they are not failures.
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
      // Whole batch rejected → nothing was created on Google. Drop the optimistic
      // rows and their tracking entries and surface the failure.
      for (const event of optimisticEvents) {
        removeEvent?.(event.id);
        optimisticCloneRequestsRef.current.delete(String(event.id));
      }
      markMonthsStale(mergeBounds(...optimisticEvents.map((event) => eventBounds(event))));
      setStatus({ tone: "error", message: "Failed to paste event." });
    }
    return true;
  }, [editable, settleOptimisticCreate, markMonthsStale]);

  const runColorUpdate = useCallback(async ({ event, colorId, scope }: {
    event: CalendarQuickActionEvent;
    colorId: string | number;
    scope?: CalendarRecurrenceScope;
  }) => {
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
      markMonthsStale(eventBounds(event));
    }
  }, [editable, markMonthsStale]);

  const runScopedColorUpdate = useCallback(async ({ events, colorId }: {
    events: CalendarQuickActionEvent[];
    colorId: string | number;
  }) => {
    const scopedEvents = Array.isArray(events) ? events : [];
    if (!scopedEvents.length || !colorId) return;
    await Promise.all(scopedEvents.map((event) => runColorUpdate({
      event,
      colorId,
      scope: event?.isRecurring ? "one" : undefined,
    })));
  }, [runColorUpdate]);

  const beginDrag = useCallback((event: CalendarQuickActionEvent) => {
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

  const openDeleteMenu = useCallback(({ event, x, y }: {
    event: CalendarQuickActionEvent;
    x: number;
    y: number;
  }) => {
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

  const requestBatchDelete = useCallback(({ events, x, y }: {
    events?: CalendarQuickActionEvent[];
    x?: number;
    y?: number;
  } = {}) => {
    const scopedEvents = (Array.isArray(events) ? events : []).filter((event) => event?.writable);
    if (!editable || !scopedEvents.length) return false;
    setPrompt(null);
    setStatus(null);
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
  }, [contextMenu?.actionScope, contextMenu?.event, runBatchDelete, runDelete]);

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
  ), []);

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
