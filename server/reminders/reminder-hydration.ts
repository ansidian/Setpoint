import {
  listUpcomingReminderStatesForSources,
  reminderSourceKey,
} from "./reminder-service.ts";
import type { Client } from "@libsql/client";
import type { ReminderSourceIdentity, UpcomingReminderState } from "../../shared/types/reminders.ts";

type DateInput = string | number | Date;
interface HydrationOptions { dbClient?: Client; now?: DateInput }
interface CalendarEventLike {
  id?: string | null;
  startMs?: number | null;
  isRecurring?: boolean;
  originalStartTime?: string | null;
}
interface TodoistTaskLike { id?: string | number | null }
export type ReminderHydrated<T> = T & {
  reminderState: UpcomingReminderState;
  hasUpcomingReminder: boolean;
  upcomingReminderCount: number;
  nextReminderAt: string | null;
};

function emptyReminderState(): UpcomingReminderState {
  return {
    hasUpcomingReminder: false,
    upcomingCount: 0,
    nextReminderAt: null,
  };
}

export function calendarEventAnchorAt(event: CalendarEventLike): string | null {
  if (!event?.startMs) return null;
  return new Date(event.startMs).toISOString();
}

function calendarEventReminderSource(event: CalendarEventLike): ReminderSourceIdentity | null {
  if (!event?.id) return null;
  return {
    sourceType: "calendar_event",
    sourceItemId: event.id,
    sourceOccurrenceId: event.isRecurring
      ? event.originalStartTime || calendarEventAnchorAt(event)
      : null,
  };
}

function todoistTaskReminderSource(task: TodoistTaskLike): ReminderSourceIdentity | null {
  if (!task?.id) return null;
  return {
    sourceType: "todoist_task",
    sourceItemId: String(task.id),
    sourceOccurrenceId: null,
  };
}

function applyUpcomingReminderState<T>(item: T, state = emptyReminderState()): ReminderHydrated<T> {
  return {
    ...item,
    reminderState: state,
    hasUpcomingReminder: state.hasUpcomingReminder,
    upcomingReminderCount: state.upcomingCount,
    nextReminderAt: state.nextReminderAt,
  };
}

async function hydrateItemsWithReminderState<T>(userId: string, items: T[], sourceForItem: (item: T) => ReminderSourceIdentity | null, {
  dbClient = undefined,
  now = undefined,
}: HydrationOptions = {}): Promise<Array<ReminderHydrated<T>>> {
  const nextItems = Array.isArray(items) ? items : [];
  const sourcesByIndex = nextItems.map(sourceForItem);
  const sources = sourcesByIndex.filter((source): source is ReminderSourceIdentity => source !== null);
  if (!sources.length) return nextItems.map((item) => applyUpcomingReminderState(item));

  const request: { userId: string; sources: ReminderSourceIdentity[]; now?: DateInput } = { userId, sources };
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

export function hydrateCalendarEventsWithReminderState<T extends CalendarEventLike>(userId: string, events: T[], options: HydrationOptions = {}): Promise<Array<ReminderHydrated<T>>> {
  return hydrateItemsWithReminderState(userId, events, calendarEventReminderSource, options);
}

export function hydrateTodoistTasksWithReminderState<T extends TodoistTaskLike>(userId: string, tasks: T[], options: HydrationOptions = {}): Promise<Array<ReminderHydrated<T>>> {
  return hydrateItemsWithReminderState(userId, tasks, todoistTaskReminderSource, options);
}
