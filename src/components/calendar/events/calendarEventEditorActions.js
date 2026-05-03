import {
  createCalendarEvent,
  createCalendarEventsBatch,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/api";
import {
  buildRecurrencePayload,
  draftBounds,
  eventBounds,
  mergeBounds,
  normalizeBatchDraftsWithErrors,
  pacificYMD,
} from "./calendarEventEditorModel";

const defaultClient = {
  create: createCalendarEvent,
  createBatch: createCalendarEventsBatch,
  update: updateCalendarEvent,
  remove: deleteCalendarEvent,
};

export function buildCalendarEventPayload({ draft, effectiveTitle }) {
  return {
    accountId: draft.accountId,
    calendarId: draft.calendarId,
    title: effectiveTitle,
    allDay: draft.allDay,
    startDate: draft.startDate,
    endDate: draft.endDate,
    startTime: draft.startTime,
    endTime: draft.endTime,
    location: draft.location,
    description: draft.description,
  };
}

export function shouldSendRecurrencePayload({
  recurrenceDraft,
  editingEvent,
  isEditingRecurring,
  recurringEditScope,
  intentMode,
}) {
  if (!recurrenceDraft) return false;
  if (!editingEvent) return intentMode === "recurring";
  if (isEditingRecurring) return recurringEditScope !== "one";
  return intentMode === "recurring";
}

export function buildBatchCreateItems({ draft, batchDrafts, effectiveTitle }) {
  return batchDrafts.map((item) => ({
    accountId: draft.accountId,
    calendarId: draft.calendarId,
    title: item.title || effectiveTitle,
    allDay: draft.allDay,
    startDate: item.startDate,
    endDate: item.endDate,
    startTime: draft.allDay ? null : item.startTime,
    endTime: draft.allDay ? null : item.endTime,
    location: draft.location,
    description: draft.description,
  }));
}

export function buildUpdateEventPayload({
  draft,
  effectiveTitle,
  editingEvent,
  isEditingRecurring,
  recurringEditScope,
  recurrenceDraft,
  shouldSendRecurrence,
}) {
  return {
    ...buildCalendarEventPayload({ draft, effectiveTitle }),
    sourceAccountId: editingEvent.accountId,
    sourceCalendarId: editingEvent.calendarId,
    etag: editingEvent.etag,
    scope: isEditingRecurring ? recurringEditScope : undefined,
    recurringEventId: isEditingRecurring ? editingEvent.recurringEventId : undefined,
    originalStartTime: isEditingRecurring ? editingEvent.originalStartTime : undefined,
    recurrence: shouldSendRecurrence
      ? buildRecurrencePayload(recurrenceDraft, draft)
      : undefined,
  };
}

export function buildDeleteEventPayload({ editingEvent, isEditingRecurring, recurringEditScope }) {
  return {
    accountId: editingEvent.accountId,
    calendarId: editingEvent.calendarId,
    etag: editingEvent.etag,
    scope: isEditingRecurring ? recurringEditScope : undefined,
    recurringEventId: isEditingRecurring ? editingEvent.recurringEventId : undefined,
    originalStartTime: isEditingRecurring ? editingEvent.originalStartTime : undefined,
  };
}

function buildPartialBatchError({ createdEvents, failed }) {
  if (createdEvents.length) {
    return `Created ${createdEvents.length} event${createdEvents.length === 1 ? "" : "s"}, but ${failed.length} still need review.`;
  }
  return failed[0]?.message || "Failed to create batch events.";
}

async function saveBatchEvents({
  draft,
  batchDrafts,
  effectiveTitle,
}, client) {
  const result = await client.createBatch(buildBatchCreateItems({
    draft,
    batchDrafts,
    effectiveTitle,
  }));
  const createdEvents = (result?.created || [])
    .map((entry) => entry?.event)
    .filter(Boolean);
  const failed = result?.failed || [];
  const bounds = mergeBounds(...createdEvents.map((event) => eventBounds(event)));
  const hasFailures = failed.length > 0;

  return {
    kind: "batch-create",
    createdEvents,
    failed,
    failedDrafts: normalizeBatchDraftsWithErrors(failed),
    bounds,
    focusDate: createdEvents[0]?.startMs ? pacificYMD(createdEvents[0].startMs) : null,
    shouldRefresh: hasFailures && !!bounds,
    shouldUpsert: !hasFailures,
    errorMessage: hasFailures ? buildPartialBatchError({ createdEvents, failed }) : null,
    errorCode: hasFailures ? failed[0]?.code || "calendar_batch_partial_failed" : null,
  };
}

export async function saveCalendarEventAction(options, client = defaultClient) {
  const {
    draft,
    effectiveTitle,
    recurrenceDraft,
    editingEvent = null,
    isEditingRecurring = false,
    recurringEditScope = null,
    intentMode = "single",
    batchDrafts = [],
  } = options;

  if (!editingEvent && intentMode === "batch") {
    return saveBatchEvents({ draft, batchDrafts, effectiveTitle }, client);
  }

  const basePayload = buildCalendarEventPayload({ draft, effectiveTitle });
  const shouldSendRecurrence = shouldSendRecurrencePayload({
    recurrenceDraft,
    editingEvent,
    isEditingRecurring,
    recurringEditScope,
    intentMode,
  });

  let savedEvent;
  if (!editingEvent && intentMode === "recurring") {
    const result = await client.create({
      ...basePayload,
      recurrence: buildRecurrencePayload(recurrenceDraft, draft),
    });
    savedEvent = result.event;
  } else if (editingEvent) {
    const result = await client.update(editingEvent.id, buildUpdateEventPayload({
      draft,
      effectiveTitle,
      editingEvent,
      isEditingRecurring,
      recurringEditScope,
      recurrenceDraft,
      shouldSendRecurrence,
    }));
    savedEvent = result.event;
  } else {
    const result = await client.create(basePayload);
    savedEvent = result.event;
  }

  const bounds = mergeBounds(eventBounds(editingEvent), draftBounds(draft), eventBounds(savedEvent));
  const shouldRefresh = (!editingEvent && intentMode === "recurring")
    || !!(editingEvent && (isEditingRecurring || shouldSendRecurrence));

  return {
    kind: editingEvent ? "update" : "create",
    savedEvent,
    bounds,
    focusDate: savedEvent?.startMs ? pacificYMD(savedEvent.startMs) : null,
    shouldRefresh: shouldRefresh && !!bounds,
    shouldUpsert: !shouldRefresh,
  };
}

export async function deleteCalendarEventAction(options, client = defaultClient) {
  const {
    editingEvent,
    isEditingRecurring = false,
    recurringEditScope = null,
  } = options;

  await client.remove(editingEvent.id, buildDeleteEventPayload({
    editingEvent,
    isEditingRecurring,
    recurringEditScope,
  }));

  const bounds = eventBounds(editingEvent);
  return {
    deletedEvent: editingEvent,
    bounds,
    shouldRefresh: isEditingRecurring && !!bounds,
    shouldRemove: !isEditingRecurring,
  };
}
