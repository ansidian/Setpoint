import {
  createCalendarEvent,
  createCalendarEventsBatch,
  deleteCalendarEvent,
  updateCalendarEvent,
  createReminder,
  deleteReminder,
} from "@/api";
import {
  type CalendarBatchMutationResponse,
  type CalendarEventMutationInput,
  type CalendarEventMutationResponse,
  type CalendarRecurrenceScope,
  type NormalizedCalendarEvent,
} from "../../../../shared/types/calendar";
import type { UpcomingReminderState } from "../../../../shared/types/reminders";
import {
  buildEventReminderCreatePayload,
  type EventReminderLike,
  isUnsavedReminder,
} from "./calendarEventReminderModel";
import {
  applyUpcomingReminderState,
  projectUpcomingReminderState,
} from "../reminderDisplay.ts";
import {
  buildRecurrencePayload,
  type CalendarBatchDraft,
  type CalendarEditorEvent,
  type CalendarEventDraft,
  type CalendarFailedBatchEntry,
  type CalendarRecurrenceDraftInput,
  draftBounds,
  eventBounds,
  mergeBounds,
  normalizeBatchDraftsWithErrors,
  pacificYMD,
} from "./calendarEventEditorModel";

export interface CalendarEditorActionEvent extends CalendarEditorEvent {
  id: string;
  etag?: string | null;
  recurringEventId?: string | null;
  originalStartTime?: string | null;
}

export interface CalendarEditorActionClient {
  create?: (payload: CalendarEventMutationInput) => Promise<CalendarEventMutationResponse>;
  createBatch?: (items: CalendarEventMutationInput[]) => Promise<CalendarBatchMutationResponse>;
  update?: (eventId: string, payload: CalendarEventMutationInput) => Promise<CalendarEventMutationResponse>;
  remove?: (eventId: string, payload: CalendarEventMutationInput) => Promise<unknown>;
  createReminder?: (payload: Parameters<typeof createReminder>[0]) => Promise<unknown>;
  deleteReminder?: (id: string | number) => Promise<unknown>;
}

interface CalendarEditorErrorLike { code?: string | null; message?: string | null }
type CalendarEditorRecurrenceScope = CalendarRecurrenceScope;

interface CalendarEventRemindersDraft {
  items: EventReminderLike[];
  removedIds: Array<string | number>;
}

export interface SaveCalendarEventActionOptions {
  draft: CalendarEventDraft;
  effectiveTitle: string;
  recurrenceDraft?: CalendarRecurrenceDraftInput | null;
  editingEvent?: CalendarEditorActionEvent | null;
  isEditingRecurring?: boolean;
  recurringEditScope?: CalendarRecurrenceScope | null;
  intentMode?: "single" | "batch" | "recurring";
  batchDrafts?: CalendarBatchDraft[];
  eventReminders?: CalendarEventRemindersDraft;
}

const projectReminderState = projectUpcomingReminderState as (
  reminders: EventReminderLike[],
  options: { anchorAt: string | null },
) => UpcomingReminderState;

const defaultClient: CalendarEditorActionClient = {
  create: createCalendarEvent,
  createBatch: createCalendarEventsBatch,
  update: updateCalendarEvent,
  remove: deleteCalendarEvent,
  createReminder,
  deleteReminder,
};

function looksLikeRawProviderError(message: unknown) {
  const text = String(message || "").trim();
  return text.startsWith("{")
    || text.startsWith("[")
    || text.includes('"error"')
    || text.length > 260;
}

export function formatCalendarEditorError(error: unknown, fallback = "Failed to save event.") {
  const candidate: CalendarEditorErrorLike = error && typeof error === "object"
    ? error as CalendarEditorErrorLike
    : {};
  const code = candidate.code || null;
  const message = candidate.message || "";

  if (code === "calendar_event_conflict") {
    return "This event changed in Google Calendar. Refresh the calendar and try again.";
  }
  if (code === "calendar_google_forbidden") {
    return "Google Calendar blocked this change. Reconnect Gmail if it keeps happening.";
  }
  if (code === "calendar_google_error" && looksLikeRawProviderError(message)) {
    return "Google Calendar could not save this event. Refresh the calendar and try again.";
  }
  return message || fallback;
}

export function buildCalendarEventPayload({ draft, effectiveTitle }: {
  draft: CalendarEventDraft;
  effectiveTitle: string;
}) {
  const payload: CalendarEventMutationInput = {
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
  if (draft.colorId) payload.colorId = draft.colorId;
  return payload;
}

export function shouldSendRecurrencePayload({
  recurrenceDraft,
  editingEvent,
  isEditingRecurring,
  recurringEditScope,
  intentMode,
}: {
  recurrenceDraft?: CalendarRecurrenceDraftInput | null;
  editingEvent?: CalendarEditorActionEvent | null;
  isEditingRecurring: boolean;
  recurringEditScope?: CalendarEditorRecurrenceScope | null;
  intentMode: string;
}) {
  if (!recurrenceDraft) return false;
  if (!editingEvent) return intentMode === "recurring";
  if (isEditingRecurring) return recurringEditScope !== "one";
  return intentMode === "recurring";
}

export function buildBatchCreateItems({ draft, batchDrafts, effectiveTitle }: {
  draft: CalendarEventDraft;
  batchDrafts: CalendarBatchDraft[];
  effectiveTitle: string;
}) {
  return batchDrafts.map((item) => {
    const payload: CalendarEventMutationInput = {
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
    };
    if (draft.colorId) payload.colorId = draft.colorId;
    return payload;
  });
}

export function buildUpdateEventPayload({
  draft,
  effectiveTitle,
  editingEvent,
  isEditingRecurring,
  recurringEditScope,
  recurrenceDraft,
  shouldSendRecurrence,
}: {
  draft: CalendarEventDraft;
  effectiveTitle: string;
  editingEvent: CalendarEditorActionEvent;
  isEditingRecurring: boolean;
  recurringEditScope?: CalendarEditorRecurrenceScope | null;
  recurrenceDraft?: CalendarRecurrenceDraftInput | null;
  shouldSendRecurrence: boolean;
}): CalendarEventMutationInput {
  return {
    ...buildCalendarEventPayload({ draft, effectiveTitle }),
    sourceAccountId: editingEvent.accountId,
    sourceCalendarId: editingEvent.calendarId,
    etag: editingEvent.etag,
    scope: isEditingRecurring ? recurringEditScope as CalendarRecurrenceScope | undefined : undefined,
    recurringEventId: isEditingRecurring ? editingEvent.recurringEventId : undefined,
    originalStartTime: isEditingRecurring ? editingEvent.originalStartTime : undefined,
    recurrence: shouldSendRecurrence
      ? buildRecurrencePayload(recurrenceDraft, draft)
      : undefined,
  };
}

export function buildDeleteEventPayload({ editingEvent, isEditingRecurring, recurringEditScope }: {
  editingEvent: CalendarEditorActionEvent;
  isEditingRecurring: boolean;
  recurringEditScope?: CalendarEditorRecurrenceScope | null;
}): CalendarEventMutationInput {
  return {
    accountId: editingEvent.accountId,
    calendarId: editingEvent.calendarId,
    etag: editingEvent.etag,
    scope: isEditingRecurring ? recurringEditScope as CalendarRecurrenceScope | undefined : undefined,
    recurringEventId: isEditingRecurring ? editingEvent.recurringEventId : undefined,
    originalStartTime: isEditingRecurring ? editingEvent.originalStartTime : undefined,
  };
}

function buildPartialBatchError({ createdEvents, failed }: {
  createdEvents: NormalizedCalendarEvent[];
  failed: CalendarFailedBatchEntry[];
}) {
  if (createdEvents.length) {
    return `Created ${createdEvents.length} event${createdEvents.length === 1 ? "" : "s"}, but ${failed.length} still need review.`;
  }
  return failed[0]?.message || "Failed to create batch events.";
}

async function saveBatchEvents({
  draft,
  batchDrafts,
  effectiveTitle,
}: {
  draft: CalendarEventDraft;
  batchDrafts: CalendarBatchDraft[];
  effectiveTitle: string;
}, client: CalendarEditorActionClient) {
  const result = await client.createBatch!(buildBatchCreateItems({
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
    kind: "batch-create" as const,
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

export interface CalendarSingleSaveResult {
  kind: "create" | "update";
  savedEvent: NormalizedCalendarEvent;
  bounds: ReturnType<typeof mergeBounds>;
  focusDate: string | null;
  shouldRefresh: boolean;
  shouldUpsert: boolean;
  reminderCreates: number;
  reminderDeletes: number;
}

type CalendarBatchSaveResult = Awaited<ReturnType<typeof saveBatchEvents>>;

export function saveCalendarEventAction(
  options: SaveCalendarEventActionOptions & { intentMode: "batch"; editingEvent?: null },
  client?: CalendarEditorActionClient,
): Promise<CalendarBatchSaveResult>;
export function saveCalendarEventAction(
  options: SaveCalendarEventActionOptions & { intentMode?: "single" | "recurring" },
  client?: CalendarEditorActionClient,
): Promise<CalendarSingleSaveResult>;
export function saveCalendarEventAction(
  options: SaveCalendarEventActionOptions,
  client?: CalendarEditorActionClient,
): Promise<CalendarBatchSaveResult | CalendarSingleSaveResult>;
export async function saveCalendarEventAction(
  options: SaveCalendarEventActionOptions,
  client: CalendarEditorActionClient = defaultClient,
) {
  const {
    draft,
    effectiveTitle,
    recurrenceDraft,
    editingEvent = null,
    isEditingRecurring = false,
    recurringEditScope = null,
    intentMode = "single",
    batchDrafts = [],
    eventReminders = { items: [], removedIds: [] },
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

  let savedEvent: NormalizedCalendarEvent;
  if (!editingEvent && intentMode === "recurring") {
    const result = await client.create!({
      ...basePayload,
      recurrence: buildRecurrencePayload(recurrenceDraft, draft),
    });
    savedEvent = result.event;
  } else if (editingEvent) {
    const result = await client.update!(editingEvent.id, buildUpdateEventPayload({
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
    const result = await client.create!(basePayload);
    savedEvent = result.event;
  }

  const removedIds = eventReminders?.removedIds || [];
  for (const reminderId of removedIds) {
    await client.deleteReminder?.(reminderId);
  }

  const reminderCreates = [];
  for (const reminder of eventReminders?.items || []) {
    if (!isUnsavedReminder(reminder)) continue;
    reminderCreates.push(await client.createReminder?.(buildEventReminderCreatePayload({
      event: savedEvent,
      reminder,
    })));
  }
  const reminderItems = eventReminders?.items || [];
  const remindersChanged = removedIds.length > 0 || reminderCreates.length > 0;
  const shouldProjectReminderState = remindersChanged || reminderItems.length > 0;
  const projectedSavedEvent = shouldProjectReminderState
    ? applyUpcomingReminderState(
      savedEvent,
      projectReminderState(reminderItems, {
        anchorAt: savedEvent?.startMs ? new Date(savedEvent.startMs).toISOString() : null,
      }),
    )
    : savedEvent;

  const bounds = mergeBounds(eventBounds(editingEvent), draftBounds(draft), eventBounds(savedEvent));
  const shouldRefresh = (!editingEvent && intentMode === "recurring")
    || !!(editingEvent && (isEditingRecurring || shouldSendRecurrence));

  return {
    kind: editingEvent ? "update" as const : "create" as const,
    savedEvent: projectedSavedEvent,
    bounds,
    focusDate: savedEvent?.startMs ? pacificYMD(savedEvent.startMs) : null,
    shouldRefresh: shouldRefresh && !!bounds,
    shouldUpsert: !shouldRefresh,
    reminderCreates: reminderCreates.length,
    reminderDeletes: removedIds.length,
  };
}

export async function deleteCalendarEventAction(
  options: {
    editingEvent: CalendarEditorActionEvent;
    isEditingRecurring?: boolean;
    recurringEditScope?: CalendarEditorRecurrenceScope | null;
  },
  client: CalendarEditorActionClient = defaultClient,
) {
  const {
    editingEvent,
    isEditingRecurring = false,
    recurringEditScope = null,
  } = options;

  await client.remove!(editingEvent.id, buildDeleteEventPayload({
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
