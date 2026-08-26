import { useCallback, useEffect, useRef, useState } from "react";
import { googleEventColorForId } from "../../../../shared/calendar-event-colors";
import type { CalendarRecurrenceScope, NormalizedCalendarEvent } from "../../../../shared/types/calendar";
import { daysBetweenYmd, pacificYMD } from "../calendarDateUtils.ts";
import { planCalendarEventClipboardPaste } from "./calendarEventSelectionModel";
import type { CalendarEventClipboard } from "./calendarEventSelectionModel";
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
import {
  calendarMutationCoordinator,
  createCalendarProviderEventId,
} from "./calendarMutationCoordinator";
import type {
  CalendarQuickActionBounds,
  CalendarQuickActionEvent,
} from "./calendarQuickActionModel";

export interface QuickActionStatus {
  tone: "pending" | "success" | "error";
  message: string;
}

export interface QuickActionScope {
  kind: "none" | "single" | "selection";
  events: CalendarQuickActionEvent[];
  identities: Array<string | null>;
}

interface OptimisticCloneRequest {
  createdEvent: NormalizedCalendarEvent | null;
  deleted: boolean;
}

export interface QuickActionExternalHandlers {
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

function quickActionErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function quickActionErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
}

export default function useCalendarEventQuickActionMutations({
  editable,
  handlers,
}: {
  editable: boolean;
  handlers: QuickActionExternalHandlers;
}) {
  const [status, setStatus] = useState<QuickActionStatus | null>(null);
  const optimisticCloneRequestsRef = useRef(new Map<string, OptimisticCloneRequest>());
  const mutationVersionsRef = useRef(new Map<string, number>());
  const externalHandlersRef = useRef<QuickActionExternalHandlers>({});

  useEffect(() => {
    externalHandlersRef.current = handlers;
  });

  const clearStatus = useCallback(() => setStatus(null), []);
  const clearSuccessStatusLater = useCallback((message: string) => {
    window.setTimeout(() => {
      setStatus((current) => (
        current?.tone === "success" && current.message === message ? null : current
      ));
    }, 1800);
  }, []);
  const mutationOptions = useCallback((pendingMessage: string) => ({
    onPhase: (phase: "mutating" | "verifying") => {
      if (phase === "verifying") {
        setStatus({ tone: "pending", message: `Checking Google after ${pendingMessage.toLowerCase()}...` });
      } else {
        setStatus({ tone: "pending", message: `${pendingMessage}...` });
      }
    },
  }), []);
  const beginEventMutation = useCallback((eventId: string | number) => {
    const key = String(eventId);
    const version = (mutationVersionsRef.current.get(key) || 0) + 1;
    mutationVersionsRef.current.set(key, version);
    return { key, version };
  }, []);
  const isLatestEventMutation = useCallback(({ key, version }: { key: string; version: number }) => (
    mutationVersionsRef.current.get(key) === version
  ), []);

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
    const mutation = beginEventMutation(event.id);
    const originalBounds = eventBounds(event);
    const shiftedBounds = eventBounds(shiftedEvent);
    const changedBounds = mergeBounds(originalBounds, shiftedBounds);
    setStatus({ tone: "pending", message: "Moving event..." });
    upsertEvents?.(shiftedEvent);
    onSelectEvent?.(eventSelectionId(shiftedEvent), pacificYMD(shiftedEvent.startMs));

    try {
      const result = await calendarMutationCoordinator.update(
        String(event.id),
        buildReschedulePayload(event, deltaDays, scope),
        mutationOptions("Moving event"),
      );
      if (result?.event && isLatestEventMutation(mutation)) upsertEvents?.(result.event);
      if (event.isRecurring && scope !== "one" && changedBounds) {
        await refreshRange?.(changedBounds.start, changedBounds.end);
      }
      setStatus({ tone: "success", message: "Event moved." });
      clearSuccessStatusLater("Event moved.");
    } catch (err) {
      const outcomeUnknown = quickActionErrorCode(err) === "calendar_outcome_unknown";
      if (!outcomeUnknown && isLatestEventMutation(mutation)) upsertEvents?.(event);
      markMonthsStale(changedBounds || originalBounds);
      if (outcomeUnknown && changedBounds) await refreshRange?.(changedBounds.start, changedBounds.end);
      setStatus({ tone: "error", message: quickActionErrorMessage(err, "Failed to move event.") });
      throw err;
    }
  }, [beginEventMutation, clearSuccessStatusLater, isLatestEventMutation, markMonthsStale, mutationOptions]);

  const runDelete = useCallback(async ({ event, scope }: {
    event: CalendarQuickActionEvent;
    scope?: CalendarRecurrenceScope;
  }) => {
    const { upsertEvents, removeEvent, refreshRange, onEventDeleted } = externalHandlersRef.current;
    const mutation = beginEventMutation(event.id);
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
          await calendarMutationCoordinator.remove(
            createdEvent.id,
            buildDeletePayload(createdEvent),
            mutationOptions("Deleting event"),
          );
          optimisticCloneRequestsRef.current.delete(optimisticId);
          setStatus({ tone: "success", message: "Event deleted." });
          clearSuccessStatusLater("Event deleted.");
        } catch (err) {
          const outcomeUnknown = quickActionErrorCode(err) === "calendar_outcome_unknown";
          if (!outcomeUnknown && isLatestEventMutation(mutation)) upsertEvents?.(createdEvent);
          markMonthsStale(eventBounds(createdEvent));
          const bounds = eventBounds(createdEvent);
          if (outcomeUnknown && bounds) await refreshRange?.(bounds.start, bounds.end);
          setStatus({ tone: "error", message: quickActionErrorMessage(err, "Failed to delete event.") });
          throw err;
        }
        return;
      }

      if (!cloneRequest) {
        setStatus({ tone: "success", message: "Event deleted." });
        clearSuccessStatusLater("Event deleted.");
      }
      return;
    }

    const bounds = eventBounds(event);
    setStatus({ tone: "pending", message: "Deleting event..." });
    removeEvent?.(event.id);
    try {
      await calendarMutationCoordinator.remove(
        String(event.id),
        buildDeletePayload(event, scope),
        mutationOptions("Deleting event"),
      );
      if (event.isRecurring && bounds) {
        await refreshRange?.(bounds.start, bounds.end);
      }
      onEventDeleted?.(eventSelectionId(event), event);
      setStatus({ tone: "success", message: "Event deleted." });
      clearSuccessStatusLater("Event deleted.");
    } catch (err) {
      const outcomeUnknown = quickActionErrorCode(err) === "calendar_outcome_unknown";
      if (!outcomeUnknown && isLatestEventMutation(mutation)) upsertEvents?.(event);
      markMonthsStale(bounds);
      if (outcomeUnknown && bounds) await refreshRange?.(bounds.start, bounds.end);
      setStatus({ tone: "error", message: quickActionErrorMessage(err, "Failed to delete event.") });
      throw err;
    }
  }, [beginEventMutation, clearSuccessStatusLater, isLatestEventMutation, markMonthsStale, mutationOptions]);

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
        clearSuccessStatusLater("Event deleted.");
      }
      return null;
    }
    if (cloneRequest) cloneRequest.createdEvent = createdEvent;
    if (cloneRequest?.deleted) {
      // Deleted mid-flight: the create still landed on Google, so delete it there
      // rather than leaving a ghost the user already dismissed in the grid.
      removeEvent?.(optimisticId);
      try {
        await calendarMutationCoordinator.remove(
          createdEvent.id,
          buildDeletePayload(createdEvent),
          mutationOptions("Deleting event"),
        );
        optimisticCloneRequestsRef.current.delete(optimisticId);
        setStatus({ tone: "success", message: "Event deleted." });
        clearSuccessStatusLater("Event deleted.");
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
  }, [clearSuccessStatusLater, markMonthsStale, mutationOptions]);

  const runClone = useCallback(async ({ event, targetDate = null }: {
    event: CalendarQuickActionEvent;
    targetDate?: string | null;
  }) => {
    const { upsertEvents, onSelectEvent, onReconcileSelection } = externalHandlersRef.current;
    if (!editable || !event?.writable) return;
    const clientEventId = createCalendarProviderEventId();
    const optimisticEvent = buildOptimisticCloneEvent(event, targetDate, clientEventId);
    const optimisticId = String(optimisticEvent.id);
    optimisticCloneRequestsRef.current.set(optimisticId, { createdEvent: null, deleted: false });
    upsertEvents?.(optimisticEvent);
    onSelectEvent?.(eventSelectionId(optimisticEvent), pacificYMD(optimisticEvent.startMs));
    try {
      const result = await calendarMutationCoordinator.create(
        buildCloneEventPayload(event, targetDate, clientEventId),
        mutationOptions("Duplicating event"),
      );
      const created = await settleOptimisticCreate(optimisticId, result?.event || null);
      // Reconcile the selected id without re-asserting the day: a delayed
      // day-move would yank the user's selection back here if they have since
      // navigated to the next paste/clone target.
      if (created) {
        onReconcileSelection?.(eventSelectionId(optimisticEvent), eventSelectionId(created));
      }
    } catch (error) {
      const outcomeUnknown = quickActionErrorCode(error) === "calendar_outcome_unknown";
      if (!outcomeUnknown) await settleOptimisticCreate(optimisticId, null);
      const bounds = eventBounds(optimisticEvent);
      markMonthsStale(bounds);
      if (outcomeUnknown && bounds) await externalHandlersRef.current.refreshRange?.(bounds.start, bounds.end);
      setStatus({ tone: "error", message: quickActionErrorMessage(error, "Failed to duplicate event.") });
    }
  }, [editable, markMonthsStale, mutationOptions, settleOptimisticCreate]);

  const runClipboardPaste = useCallback(async ({ clipboard, targetDate = null }: {
    clipboard: CalendarEventClipboard;
    targetDate?: string | null;
  }) => {
    const { upsertEvents, removeEvent, onSelectEvent, onReconcileSelection } = externalHandlersRef.current;
    if (!editable || !targetDate) return false;
    const plan = planCalendarEventClipboardPaste(clipboard, targetDate);
    if (!plan?.items?.length) return false;

    const clientEventIds = plan.items.map(() => createCalendarProviderEventId());
    const createItems = plan.items.map((item, index) => ({
      ...item,
      clientEventId: clientEventIds[index],
    }));
    const optimisticEvents = plan.items.map((item, index) => (
      buildOptimisticClipboardPasteEvent(item, index, clientEventIds[index])
    ));
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
        const result = await calendarMutationCoordinator.create(
          createItems[0]!,
          mutationOptions("Pasting event"),
        );
        const created = await settleOptimisticCreate(optimisticId, result?.event || null);
        if (created) {
          onReconcileSelection?.(eventSelectionId(optimisticEvent), eventSelectionId(created));
        }
      } catch (error) {
        const outcomeUnknown = quickActionErrorCode(error) === "calendar_outcome_unknown";
        // Surface paste failure instead of silently rolling back the optimistic
        // row, matching the reschedule/delete error UX.
        if (!outcomeUnknown) {
          removeEvent?.(optimisticId);
          optimisticCloneRequestsRef.current.delete(optimisticId);
        }
        markMonthsStale(eventBounds(optimisticEvent));
        const bounds = eventBounds(optimisticEvent);
        if (outcomeUnknown && bounds) await externalHandlersRef.current.refreshRange?.(bounds.start, bounds.end);
        setStatus({ tone: "error", message: quickActionErrorMessage(error, "Failed to paste event.") });
      }
      return true;
    }

    try {
      const result = await calendarMutationCoordinator.createBatch(
        createItems,
        mutationOptions("Pasting events"),
      );
      const createdByIndex = new Map((result?.created || [])
        .filter((entry) => Number.isInteger(entry?.index) && entry?.event)
        .map((entry) => [entry.index, entry.event]));
      const unknownIndexes = new Set((result?.failed || [])
        .filter((entry) => entry.code === "calendar_outcome_unknown")
        .map((entry) => entry.index));

      let firstLiveCreated: NormalizedCalendarEvent | null = null;
      for (let index = 0; index < optimisticEvents.length; index += 1) {
        const optimisticId = String(optimisticEvents[index]!.id);
        if (unknownIndexes.has(index)) continue;
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
      if (unknownIndexes.size) {
        const bounds = mergeBounds(...optimisticEvents.map((event) => eventBounds(event)));
        markMonthsStale(bounds);
        if (bounds) await externalHandlersRef.current.refreshRange?.(bounds.start, bounds.end);
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
  }, [editable, settleOptimisticCreate, markMonthsStale, mutationOptions]);

  const runColorUpdate = useCallback(async ({ event, colorId, scope }: {
    event: CalendarQuickActionEvent;
    colorId: string | number;
    scope?: CalendarRecurrenceScope;
  }) => {
    const { upsertEvents, refreshRange } = externalHandlersRef.current;
    if (!editable || !event?.writable || !colorId) return;
    const mutation = beginEventMutation(event.id);
    const color = googleEventColorForId(colorId)?.hex || event.color;
    const optimisticEvent = { ...event, colorId, color };
    upsertEvents?.(optimisticEvent);
    try {
      const result = await calendarMutationCoordinator.update(
        String(event.id),
        buildColorUpdatePayload(event, colorId, scope),
        mutationOptions("Updating color"),
      );
      if (result?.event && isLatestEventMutation(mutation)) upsertEvents?.(result.event);
      if (event.isRecurring && scope !== "one") {
        const bounds = eventBounds(event);
        if (bounds) await refreshRange?.(bounds.start, bounds.end);
      }
    } catch (error) {
      const outcomeUnknown = quickActionErrorCode(error) === "calendar_outcome_unknown";
      if (!outcomeUnknown && isLatestEventMutation(mutation)) upsertEvents?.(event);
      markMonthsStale(eventBounds(event));
      const bounds = eventBounds(event);
      if (outcomeUnknown && bounds) await refreshRange?.(bounds.start, bounds.end);
      setStatus({ tone: "error", message: quickActionErrorMessage(error, "Failed to update event color.") });
    }
  }, [beginEventMutation, editable, isLatestEventMutation, markMonthsStale, mutationOptions]);

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

  return {
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
  };
}
