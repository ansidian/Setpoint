import type { DemoSeed } from "./store.ts";

export type DemoLane = keyof DemoSeed["activeSnapshot"]["lanes"];

export interface DemoRequestBody extends Record<string, unknown> {
  archived?: boolean;
  account_id?: string;
  allDay?: boolean;
  at?: string;
  calendarId?: string;
  content?: string;
  description?: string;
  due_date?: string;
  dueDate?: string;
  due_time?: string;
  dueTime?: string;
  end?: string;
  endIso?: string;
  endDate?: string;
  endDateTime?: string;
  endTime?: string;
  feedUrl?: string;
  hnQuery?: string;
  ids?: Array<string | number>;
  items?: DemoRequestBody[];
  kind?: "rss" | "hn";
  lane?: DemoLane;
  location?: string;
  reminderKind?: "fixed" | "time_to_leave";
  sourceType?: "calendar_event" | "todoist_task";
  sourceAccountId?: string | null;
  sourceCalendarId?: string | null;
  sourceItemId?: string;
  sourceOccurrenceId?: string | null;
  anchorKind?: "event_start" | "todoist_due_datetime" | "todoist_date_9am_pacific";
  anchorAt?: string;
  offsetMinutes?: number;
  eventStart?: string;
  eventLocation?: string;
  arrivalBufferMinutes?: number;
  isAllDay?: boolean;
  isRecurring?: boolean;
  payloadSnapshot?: Record<string, unknown> | null;
  minPoints?: number;
  name?: string;
  noteIds?: Array<string | number>;
  q?: string;
  senders?: DemoSeed["importantSenders"];
  sender_address?: string;
  siteUrl?: string | null;
  start?: string;
  startIso?: string;
  startDate?: string;
  startDateTime?: string;
  startTime?: string;
  status?: string;
  title?: string;
  topicId?: number;
  uids?: string[];
}

export interface DemoApiRequest {
  path: string;
  url: URL;
  pathname: string;
  method: string;
  seed: DemoSeed;
  body: DemoRequestBody;
}

export const NO_DEMO_API_RESPONSE = Symbol("NO_DEMO_API_RESPONSE");

interface DemoNotFoundError extends Error {
  code: "DEMO_NOT_FOUND";
  status: 404;
}

export function demoNotFound(path: string): never {
  const error = new Error(`Demo data not found for ${path}.`) as DemoNotFoundError;
  error.code = "DEMO_NOT_FOUND";
  error.status = 404;
  throw error;
}

export function demoPathSegment(pathname: string, fromEnd: number): string {
  const segments = pathname.split("/");
  return segments[segments.length - fromEnd] ?? "";
}
