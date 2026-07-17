import type { UpcomingReminderState } from "./reminders.ts";

export type TodoistId = string;
export type TodoistPriority = 1 | 2 | 3 | 4 | null;
export type DeadlineStatus = "complete" | "incomplete";

export interface TodoistProject {
  id: TodoistId;
  name: string;
  color: string;
  isInbox?: boolean;
}

export interface TodoistLabel {
  id: TodoistId;
  name: string;
  color: string;
}

export interface TodoistTask {
  id: TodoistId;
  title: string;
  due_date: string | null;
  due_time: string | null;
  class_name: string;
  class_color: string;
  points_possible: number | null;
  status?: DeadlineStatus;
  source: "todoist";
  sourceLabel?: string;
  color?: string;
  sourceColor?: string;
  description: string;
  url: string | null;
  priority: TodoistPriority;
  labels: string[];
  is_recurring: boolean;
  completed_at?: string | null;
  _tombstone?: boolean;
  _completing?: boolean;
  reminderState?: UpcomingReminderState;
  [key: string]: unknown;
}

export interface DeadlineMutationRequest {
  title?: string;
  description?: string;
  projectId?: TodoistId | null;
  labelIds?: string[];
  priority?: TodoistPriority;
  dueDate?: string | null;
  dueTime?: string | null;
  dueString?: string | null;
}

export interface DeadlineOccurrence extends TodoistTask {
  sourceLabel: string;
  color: string;
  sourceColor: string;
}

export interface DeadlineStats {
  incomplete: number;
  dueToday: number;
  dueThisWeek: number;
  totalPoints: number;
}

export type TodoistMirrorHealthState =
  | "unconfigured"
  | "unavailable"
  | "syncing"
  | "needs_sync"
  | "degraded"
  | "stale"
  | "current";
export type TodoistMirrorHealthSeverity = "none" | "info" | "warning" | "error";

export interface TodoistMirrorHealth {
  state: TodoistMirrorHealthState;
  configured: boolean | null;
  severity?: TodoistMirrorHealthSeverity;
  lastSuccessAt: string | null;
  lastError: string | null;
  syncStartedAt: string | null;
  syncRequestedAt?: string | null;
  syncRequestReason?: string | null;
  lastCheckFailedAt?: string | null;
  failedCheckCount?: number;
  ageMs: number | null;
}

export interface DeadlinePayload {
  upcoming: DeadlineOccurrence[];
  stats: DeadlineStats;
  syncHealth?: TodoistMirrorHealth;
}

export interface DeadlineRangeResult {
  payload: DeadlinePayload;
  errors: Array<{ source: string; message: string }>;
}

export interface CalendarDeadlineRangeResponse extends DeadlinePayload {
  minDate: string;
  errors: DeadlineRangeResult["errors"];
  fetchedAt: string;
}

export interface CompleteDeadlineOccurrenceResult {
  completed: true;
  alreadyCompleted: boolean;
  deadlineId: string;
  occurrenceDate: string;
}

export interface TodoistMutationResponse {
  success: true;
}

export interface DeadlineDeleteResponse {
  ok: true;
}

export interface TodoistWebhookDelta {
  eventName: string;
  eventData: Record<string, unknown>;
  userId?: string | null;
  initiatedFrom?: string | null;
  version?: string | null;
}
