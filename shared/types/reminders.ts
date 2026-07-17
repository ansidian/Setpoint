export type ReminderId = string;
export type ReminderSourceType = "calendar_event" | "todoist_task";
export type ReminderAnchorKind = "event_start" | "todoist_due_datetime" | "todoist_date_9am_pacific";
export type ReminderStatus = "pending" | "sent" | "missed";
export type ReminderTriggerState = "pending" | "due" | "missed";

export interface ReminderSourceIdentity {
  sourceType: ReminderSourceType;
  sourceItemId: string;
  sourceOccurrenceId?: string | null;
}

export type ReminderAnchorSource =
  | { sourceType: "calendar_event"; startAt: string }
  | { sourceType: "todoist_task"; dueDateTime?: string | null; dueDate?: string | null };

export interface ReminderAnchor {
  anchorKind: ReminderAnchorKind;
  anchorAt: string;
}

export interface ReminderPayloadSnapshot extends Record<string, unknown> {
  title?: string;
  name?: string;
  context?: string;
  sourceLabel?: string;
  url?: string;
  description?: string;
  color?: string;
}

export interface Reminder {
  id: ReminderId;
  user_id: string;
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

export interface UpcomingReminderState {
  hasUpcomingReminder: boolean;
  upcomingCount: number;
  nextReminderAt: string | null;
}

export interface CreateReminderRequest extends ReminderSourceIdentity {
  sourceAccountId?: string | null;
  sourceCalendarId?: string | null;
  anchorKind: ReminderAnchorKind;
  anchorAt: string;
  offsetMinutes: number;
  payloadSnapshot?: ReminderPayloadSnapshot | null;
}

export interface CreateReminderInput extends CreateReminderRequest {
  userId: string;
}

export type ReminderListOptions = Partial<ReminderSourceIdentity>;
export interface ReminderListResponse { reminders: Reminder[] }
export interface CreateReminderResponse { reminder: Reminder }
export interface ReminderMutationResponse { success: true }
export interface DiscordReminderTestResponse { success: true; status: number }

export interface ReminderDateTimeSelection {
  date: string;
  time: string;
}
