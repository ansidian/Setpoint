import type {
  CalendarRecurrenceScope,
  NormalizedCalendarEvent,
} from "../../shared/types/calendar.ts";
import {
  deleteCalendarSearchMirrorOccurrence,
  markCalendarSearchMirrorDirty,
  upsertCalendarSearchMirrorOccurrence,
} from "./calendar-search-mirror.ts";
import {
  deleteSourceReminders,
  reconcileTimeToLeaveReminderForEvent,
  recomputeUnsentRemindersForSource,
  scheduleTimeToLeaveRefreshForSource,
} from "../reminders/reminder-service.ts";

type RecurrenceIdentity = {
  scope?: CalendarRecurrenceScope;
  recurringEventId?: string | null;
  originalStartTime?: string | null;
};

type CalendarEventWriteEffect =
  | {
      type: "created";
      userId: string;
      event: NormalizedCalendarEvent;
    }
  | ({
      type: "updated";
      userId: string;
      eventId: string;
      event: NormalizedCalendarEvent;
      accountId?: string;
      calendarId?: string;
      sourceCalendarId?: string;
    } & RecurrenceIdentity)
  | ({
      type: "deleted";
      userId: string;
      accountId?: string;
      calendarId?: string;
      eventId: string;
    } & RecurrenceIdentity);

type RouteError = Error & { status?: number; code?: string };

function routeError(error: unknown): RouteError {
  return error as RouteError;
}

function calendarEventAnchorAt(event: Pick<NormalizedCalendarEvent, "startMs">): string | null {
  if (!event.startMs) return null;
  return new Date(event.startMs).toISOString();
}

function isRecurringWrite(
  event: NormalizedCalendarEvent | null,
  recurrence: RecurrenceIdentity = {},
) {
  return !!(
    event?.isRecurring
    || event?.recurringEventId
    || event?.recurrence
    || recurrence.scope
    || recurrence.recurringEventId
    || recurrence.originalStartTime
  );
}

function scheduleMirrorDirty({
  userId,
  accountId,
  calendarId,
}: {
  userId: string;
  accountId: string;
  calendarId: string;
}) {
  markCalendarSearchMirrorDirty(userId, {
    accountId,
    calendarId,
    reason: "calendar-write",
  }).catch((err: unknown) => {
    console.error("[Calendar] search mirror dirty marking failed:", routeError(err).message);
  });
}

function scheduleMirrorUpsert(userId: string, event: NormalizedCalendarEvent) {
  if (!event.accountId || !event.calendarId) return;
  if (isRecurringWrite(event)) {
    scheduleMirrorDirty({ userId, accountId: event.accountId, calendarId: event.calendarId });
    return;
  }
  upsertCalendarSearchMirrorOccurrence(userId, event).catch((err: unknown) => {
    console.error("[Calendar] search mirror write-through failed:", routeError(err).message);
  });
}

function scheduleMirrorDelete({
  userId,
  accountId,
  calendarId,
  eventId,
  ...recurrence
}: {
  userId: string;
  accountId?: string;
  calendarId?: string;
  eventId: string;
} & RecurrenceIdentity) {
  if (!accountId || !calendarId) return;
  if (isRecurringWrite(null, recurrence)) {
    scheduleMirrorDirty({ userId, accountId, calendarId });
    return;
  }
  deleteCalendarSearchMirrorOccurrence(userId, { accountId, calendarId, eventId }).catch(
    (err: unknown) => {
      console.error(
        "[Calendar] search mirror delete write-through failed:",
        routeError(err).message,
      );
    },
  );
}

function occurrenceIdentity(
  event: NormalizedCalendarEvent,
  { originalStartTime, scope }: RecurrenceIdentity,
) {
  if (scope && scope !== "one") return undefined;
  if (originalStartTime) return originalStartTime;
  if (!event.isRecurring) return undefined;
  return event.originalStartTime || calendarEventAnchorAt(event) || undefined;
}

async function applyUpdateEffects(effect: Extract<CalendarEventWriteEffect, { type: "updated" }>) {
  const {
    userId,
    eventId,
    event,
    accountId,
    calendarId,
    sourceCalendarId,
    scope,
    recurringEventId,
    originalStartTime,
  } = effect;
  const recurrence = { scope, recurringEventId, originalStartTime };
  if (
    sourceCalendarId
    && sourceCalendarId !== calendarId
    && !isRecurringWrite(event, recurrence)
  ) {
    scheduleMirrorDelete({
      userId,
      accountId,
      calendarId: sourceCalendarId,
      eventId,
    });
  }
  scheduleMirrorUpsert(userId, event);

  const anchorAt = calendarEventAnchorAt(event);
  if (!anchorAt) return;
  try {
    await recomputeUnsentRemindersForSource({
      userId,
      sourceType: "calendar_event",
      sourceItemId: eventId,
      sourceOccurrenceId: occurrenceIdentity(event, recurrence),
      anchorKind: "event_start",
      anchorAt,
    });
    if (scope && scope !== "one") {
      await scheduleTimeToLeaveRefreshForSource({
        userId,
        sourceType: "calendar_event",
        sourceItemId: eventId,
        sourceOccurrenceId: undefined,
      });
    } else {
      await reconcileTimeToLeaveReminderForEvent({
        userId,
        sourceItemId: eventId,
        sourceOccurrenceId: occurrenceIdentity(event, recurrence),
        event,
      });
    }
  } catch (err) {
    console.error(
      "[Calendar] reminder recompute after event update failed:",
      routeError(err).message,
    );
  }
}

async function applyDeleteEffects(effect: Extract<CalendarEventWriteEffect, { type: "deleted" }>) {
  const { userId, eventId, scope, originalStartTime } = effect;
  scheduleMirrorDelete(effect);
  try {
    await deleteSourceReminders({
      userId,
      sourceType: "calendar_event",
      sourceItemId: eventId,
      sourceOccurrenceId:
        scope && scope !== "one"
          ? undefined
          : originalStartTime || undefined,
    });
  } catch (err) {
    console.error(
      "[Calendar] reminder cleanup after event delete failed:",
      routeError(err).message,
    );
  }
}

export async function applyCalendarEventWriteEffects(effect: CalendarEventWriteEffect) {
  if (effect.type === "created") {
    scheduleMirrorUpsert(effect.userId, effect.event);
    return;
  }
  if (effect.type === "updated") {
    await applyUpdateEffects(effect);
    return;
  }
  await applyDeleteEffects(effect);
}
