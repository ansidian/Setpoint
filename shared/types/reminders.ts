export type ReminderId = string;
export type ReminderKind = "fixed" | "time_to_leave";
export type ReminderSourceType = "calendar_event" | "todoist_task";
export type ReminderAnchorKind = "event_start" | "todoist_due_datetime" | "todoist_date_9am_pacific";
export type ReminderStatus = "pending" | "sent" | "missed";
export type ReminderTriggerState = "pending" | "due" | "missed";
export type TimeToLeaveRouteStatus = "ready" | "degraded" | "blocked";

export interface ReminderSourceIdentity {
  sourceType: ReminderSourceType;
  sourceItemId: string;
  sourceOccurrenceId?: string | null;
}

export interface ReminderAnchor {
  anchorKind: ReminderAnchorKind;
  anchorAt: string;
}

export interface ReminderPayloadSnapshot extends Record<string, unknown> {
  title?: string;
  name?: string;
  context?: string;
  sourceLabel?: string;
  url?: string | null;
  description?: string;
  color?: string | null;
  location?: string | null;
}

interface ReminderBase {
  id: ReminderId;
  user_id: string;
  reminder_kind: ReminderKind;
  source_type: ReminderSourceType;
  source_account_id: string | null;
  source_calendar_id: string | null;
  source_item_id: string;
  source_occurrence_id: string | null;
  anchor_kind: ReminderAnchorKind;
  anchor_at: string;
  offset_minutes: number;
  remind_at: string;
  status: ReminderStatus;
  sent_at: string | null;
  missed_at: string | null;
  retry_count: number;
  retry_after: string | null;
  last_error: string | null;
  payload_snapshot_json: string | null;
  payload_snapshot: ReminderPayloadSnapshot | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface FixedReminder extends ReminderBase {
  reminder_kind: "fixed";
  arrival_buffer_minutes: null;
  route_duration_seconds: null;
  route_distance_meters: null;
  route_checked_at: null;
  next_route_check_at: null;
  route_status: null;
  route_error_code: null;
}

export interface TimeToLeaveReminder extends ReminderBase {
  reminder_kind: "time_to_leave";
  arrival_buffer_minutes: number;
  route_duration_seconds: number;
  route_distance_meters: number;
  route_checked_at: string;
  next_route_check_at: string | null;
  route_status: TimeToLeaveRouteStatus;
  route_error_code: string | null;
}

export type Reminder = FixedReminder | TimeToLeaveReminder;

export interface UpcomingReminderState {
  hasUpcomingReminder: boolean;
  upcomingCount: number;
  nextReminderAt: string | null;
}

export interface CreateFixedReminderRequest extends ReminderSourceIdentity {
  reminderKind?: "fixed";
  sourceAccountId?: string | null;
  sourceCalendarId?: string | null;
  anchorKind: ReminderAnchorKind;
  anchorAt: string;
  offsetMinutes: number;
  payloadSnapshot?: ReminderPayloadSnapshot | null;
}

export interface CreateTimeToLeaveReminderRequest extends ReminderSourceIdentity {
  reminderKind: "time_to_leave";
  sourceType: "calendar_event";
  sourceAccountId?: string | null;
  sourceCalendarId?: string | null;
  eventStart: string;
  eventLocation: string;
  isAllDay?: boolean;
  isRecurring?: boolean;
  arrivalBufferMinutes?: number;
  payloadSnapshot?: ReminderPayloadSnapshot | null;
}

export type CreateReminderRequest = CreateFixedReminderRequest | CreateTimeToLeaveReminderRequest;

export type CreateReminderInput = CreateReminderRequest & {
  userId: string;
};

export type ReminderListOptions = Partial<ReminderSourceIdentity>;
export interface ReminderListResponse { reminders: Reminder[] }
export interface CreateReminderResponse { reminder: Reminder }
export interface ReminderMutationResponse { success: true }
export interface DiscordReminderTestResponse { success: true; status: number }

export interface ReminderDateTimeSelection {
  date: string;
  time: string;
}
