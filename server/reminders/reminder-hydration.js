import {
  listUpcomingReminderStatesForSources,
  reminderSourceKey,
} from "./reminder-service.js";

function emptyReminderState() {
  return {
    hasUpcomingReminder: false,
    upcomingCount: 0,
    nextReminderAt: null,
  };
}

export function calendarEventAnchorAt(event) {
  if (!event?.startMs) return null;
  return new Date(event.startMs).toISOString();
}

function calendarEventReminderSource(event) {
  if (!event?.id) return null;
  return {
    sourceType: "calendar_event",
    sourceItemId: event.id,
    sourceOccurrenceId: event.isRecurring
      ? event.originalStartTime || calendarEventAnchorAt(event)
      : null,
  };
}

function todoistTaskReminderSource(task) {
  if (!task?.id) return null;
  return {
    sourceType: "todoist_task",
    sourceItemId: String(task.id),
    sourceOccurrenceId: null,
  };
}

function applyUpcomingReminderState(item, state = emptyReminderState()) {
  return {
    ...item,
    reminderState: state,
    hasUpcomingReminder: state.hasUpcomingReminder,
    upcomingReminderCount: state.upcomingCount,
    nextReminderAt: state.nextReminderAt,
  };
}

async function hydrateItemsWithReminderState(userId, items, sourceForItem, {
  dbClient = undefined,
  now = undefined,
} = {}) {
  const nextItems = Array.isArray(items) ? items : [];
  const sourcesByIndex = nextItems.map(sourceForItem);
  const sources = sourcesByIndex.filter(Boolean);
  if (!sources.length) return nextItems;

  const request = { userId, sources };
  if (now) request.now = now;
  const stateByKey = dbClient
    ? await listUpcomingReminderStatesForSources(request, { dbClient })
    : await listUpcomingReminderStatesForSources(request);

  return nextItems.map((item, index) => {
    const source = sourcesByIndex[index];
    const state = source
      ? stateByKey.get(reminderSourceKey(source)) || emptyReminderState()
      : emptyReminderState();
    return applyUpcomingReminderState(item, state);
  });
}

export function hydrateCalendarEventsWithReminderState(userId, events, options = {}) {
  return hydrateItemsWithReminderState(userId, events, calendarEventReminderSource, options);
}

export function hydrateTodoistTasksWithReminderState(userId, tasks, options = {}) {
  return hydrateItemsWithReminderState(userId, tasks, todoistTaskReminderSource, options);
}
