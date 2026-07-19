import type { UpcomingReminderState } from "./reminders.ts";

export type CalendarId = string;
export type CalendarEventId = string;
export type CalendarRecurrenceScope = "one" | "following" | "all";
export type CalendarView = "events" | "bills";

export interface CalendarAccount {
  id: string;
  label?: string;
  email: string;
  color?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expires_at?: string | number | null;
  scopes?: string[] | string | null;
  type?: string;
  calendar_enabled?: boolean | number;
  user_id?: string;
}

export interface GoogleCalendarSource {
  id: CalendarId;
  summary: string;
  backgroundColor?: string | null;
  foregroundColor?: string | null;
  accessRole?: string | null;
  writable?: boolean;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
  timeZone?: string | null;
  syntheticCalendarListFallback?: boolean;
}

export interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEventAttendee {
  email?: string;
  displayName?: string;
  resource?: boolean;
  responseStatus?: string;
}

export interface GoogleEventResource {
  id: CalendarEventId;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  eventType?: string;
  colorId?: string | number | null;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  originalStartTime?: GoogleEventDateTime;
  recurringEventId?: string;
  recurrence?: string[];
  attendees?: GoogleEventAttendee[];
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  birthdayProperties?: { type?: string; customTypeName?: string; contact?: string };
  reminders?: unknown;
  transparency?: string;
  visibility?: string;
  creator?: { email?: string; displayName?: string; self?: boolean };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  sequence?: number;
  updated?: string;
}

export interface CalendarRecurrenceEnds {
  type: "never" | "onDate" | "afterCount";
  untilDate?: string;
  count?: number;
}

export interface CalendarRecurrenceInput {
  frequency: "daily" | "weekly" | "monthly" | "yearly" | string;
  interval?: number;
  weekdays?: string[];
  monthDay?: number | null;
  month?: number | null;
  ends?: CalendarRecurrenceEnds;
}

export interface StructuredCalendarRecurrence extends CalendarRecurrenceInput {
  interval: number;
  weekdays: string[];
  monthDay: number | null;
  month: number | null;
  ends: CalendarRecurrenceEnds;
  rules?: string[];
}

export interface CalendarEventMutationInput {
  accountId?: string;
  calendarId?: CalendarId;
  sourceAccountId?: string;
  originalCalendarId?: CalendarId;
  sourceCalendarId?: CalendarId;
  title?: string;
  description?: string;
  location?: string;
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
  startTime?: string | null;
  endTime?: string | null;
  startDateTime?: string;
  endDateTime?: string;
  timeZone?: string;
  recurrence?: CalendarRecurrenceInput | string[] | null;
  recurrenceScope?: CalendarRecurrenceScope | null;
  scope?: CalendarRecurrenceScope | null;
  originalStartTime?: string | null;
  recurringEventId?: string | null;
  attendees?: Array<string | { email: string }>;
  colorId?: string | number | null;
  etag?: string | null;
  reminders?: unknown;
}

export interface NormalizedCalendarEvent {
  id: CalendarEventId;
  etag: string | null;
  eventType?: string;
  birthdayProperties?: { type: string; customTypeName: string; contact: string } | null;
  htmlLink?: string | null;
  openUrl?: string | null;
  title: string;
  time: string;
  duration: string;
  location: string;
  description: string;
  attendees?: string[];
  hangoutLink?: string | null;
  source: string;
  sourceColor: string;
  sourceColorId?: string | null;
  accountId: string;
  accountLabel: string;
  accountEmail: string;
  calendarId: CalendarId;
  calendarName: string;
  colorId?: string | null;
  color?: string;
  flag?: "Conflict" | null;
  allDay: boolean;
  startMs: number;
  endMs: number;
  writable?: boolean;
  readOnlyReason?: string | null;
  isRecurring: boolean;
  recurringEventId: string | null;
  originalStartTime: string | null;
  recurringKind: "series" | "instance" | null;
  status: string;
  recurrence?: StructuredCalendarRecurrence | null;
  passed?: boolean;
  dayLabel?: string;
  conflict?: boolean;
  reminderState?: UpcomingReminderState;
}

export interface CalendarRangeValidationValue {
  start: string;
  end: string;
  startDate: Date;
  endDate: Date;
  minDate?: string;
}

export type CalendarRangeValidationResult =
  | { ok: true; value: CalendarRangeValidationValue }
  | { ok: false; message: string };

export interface CalendarRangeResponse {
  events: NormalizedCalendarEvent[];
  errors?: Array<{ account?: string; calendar?: string; message: string; code?: string }>;
  fetchedAt?: string;
}

export type CalendarSearchResultType = "event" | "deadline" | "bill";

export interface CalendarSearchActivation {
  view: CalendarView;
  detailView?: CalendarView;
  detailKind?: "deadline";
  dateKey: string | null;
  itemId: string;
  eventId?: string;
  deadlineId?: string;
  scheduleId?: string | null;
  accountId?: string | null;
  calendarId?: string | null;
  originalStartTime?: string | null;
}

export interface CalendarSearchResult {
  id: string;
  type: CalendarSearchResultType;
  itemId: string;
  itemDate: string | null;
  title: string;
  subtitle: string;
  location?: string;
  status?: string | null;
  meta: string;
  sourceLabel: string;
  sourceColor: string;
  coverageKey: string;
  activation: CalendarSearchActivation;
  payload: CalendarSearchPayload;
  matchReason?: "exact" | "word_start" | "field";
  rankBucket?: number;
}

export interface CalendarSearchPayload {
  id?: string;
  accountId?: string | null;
  calendarId?: string | null;
  startMs?: number;
  endMs?: number;
  allDay?: boolean;
  originalStartTime?: string | null;
  dueDate?: string | null;
  status?: string | null;
  scheduleId?: string | null;
  nextDate?: string | null;
  paid?: boolean;
}

export interface CalendarSearchCandidate extends CalendarSearchResult {
  matchFields: { primary: Array<string | null | undefined>; secondary: Array<string | null | undefined> };
}

export type CalendarMirrorHealthState = "initializing" | "syncing" | "dirty" | "degraded" | "stale" | "current" | "unavailable";
export type CalendarMirrorHealthSeverity = "none" | "info" | "warning" | "error";

export interface CalendarMirrorSourceHealth {
  accountId: string;
  calendarId: string;
  accountLabel: string | null;
  accountEmail: string | null;
  calendarLabel: string;
  sourceColor: string | null;
  windowStart: string;
  windowEnd: string;
  state: CalendarMirrorHealthState;
  severity: CalendarMirrorHealthSeverity;
  lastSuccessAt: string | null;
  lastError: string | null;
  syncStartedAt: string | null;
  syncRequestedAt: string | null;
  syncRequestReason: string | null;
  dirtySince: string | null;
  dirtyReason: string | null;
  lastCheckFailedAt: string | null;
  failedCheckCount: number;
  ageMs: number | null;
}

export interface CalendarMirrorHealth {
  state: CalendarMirrorHealthState;
  configured: boolean;
  severity: CalendarMirrorHealthSeverity;
  sources: CalendarMirrorSourceHealth[];
}

export interface CalendarSearchResponse {
  results: CalendarSearchResult[];
  totalMatches: number;
  truncated: boolean;
  query: string;
  scope: string;
  limit: number;
  resultCount?: number;
  fetchedAt?: string;
  coverage?: unknown;
  mirrorHealth?: CalendarMirrorHealth;
  errors?: Array<{ source: string; message: string }>;
}

export interface CalendarEventMutationResponse {
  event: NormalizedCalendarEvent;
  reminderErrors?: Array<{ message: string }>;
}

export interface CalendarBatchMutationResponse {
  created: Array<{ index: number; event: NormalizedCalendarEvent }>;
  failed: Array<{
    index: number;
    input: CalendarEventMutationInput;
    code: string;
    message: string;
  }>;
}

export interface CalendarSourcesResponse {
  accounts: Array<{
    accountId: string;
    accountLabel: string;
    accountEmail: string;
    calendars: GoogleCalendarSource[];
  }>;
}

export interface CalendarPlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText?: string;
  fullText: string;
  distanceMeters: number | null;
}

export interface CalendarPlaceDetails {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  location: string;
  lat: number | null;
  lng: number | null;
  googleMapsUri: string;
}

export interface CalendarPlaceSuggestionsResponse {
  places: CalendarPlaceSuggestion[];
}

export interface CalendarPlaceDetailsResponse {
  place: CalendarPlaceDetails;
}

export interface CalendarDeleteResponse {
  ok: true;
}
