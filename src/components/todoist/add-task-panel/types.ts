import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type {
  DeadlineMutationRequest,
  TodoistLabel,
  TodoistPriority,
  TodoistProject,
  TodoistTask,
} from "../../../../shared/types/tasks";
import type {
  CreateReminderRequest,
  Reminder,
  ReminderDateTimeSelection,
  ReminderStatus,
} from "../../../../shared/types/reminders";

export type AddTaskPanelHost = "anchored" | "floating" | "modal" | "inline";
export type AutocompleteType = "project" | "label" | null;
export type CompactPanel = "description" | "project" | "priority" | "labels" | "due" | "reminders" | null;

export interface TodoistEditorTask extends Partial<TodoistTask> {
  id?: string;
  title?: string;
  content?: string;
  project_id?: string | null;
  project_name?: string | null;
  due_string?: string | null;
}

export interface AddTaskPanelProps {
  anchorRef?: RefObject<HTMLElement | null> | null;
  editingTask?: TodoistEditorTask | null;
  host?: AddTaskPanelHost;
  initialDescription?: string;
  initialDueDate?: string | null;
  initialInput?: string;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onDraftPreviewChange?: (preview: AddTaskDraftPreview | null) => void;
  onTaskAdded?: (task: TodoistEditorTask) => void;
  onTaskDeleted?: (taskId: string) => void;
  onTaskUpdated?: (task: TodoistEditorTask) => void;
}

export interface TimeParts {
  hour: number;
  minute: number;
}

export interface ResolvedDate {
  date: Date;
  time: TimeParts | null;
  phrase?: string;
}

export interface TodoistRecurrenceDraft {
  frequency?: "daily" | "weekly" | "monthly" | "yearly" | string;
  interval?: number | string;
  weekdays?: string[];
  startDate?: string | null;
  startTime?: string | null;
  [key: string]: unknown;
}

export interface DuePreview {
  dueDate: string;
  dueTime: string | null;
  dueTime24?: string | null;
  dueMinutes?: number | null;
}

export interface ParsedTodoistTokens {
  priority: TodoistPriority;
  project: TodoistProject | null;
  labels: TodoistLabel[];
  datePhrase: string | null;
  dateDueString: string | null;
  dateFormatted: string | null;
  duePreview: DuePreview | null;
  recurrenceDraft: TodoistRecurrenceDraft | null;
  recurrenceSummary: string | null;
  recurringDueString: string | null;
  stripped: string;
}

export type ParsedTodoistTokensInput = Partial<ParsedTodoistTokens> & { stripped?: string };
export type TodoistNamedReference = { id?: string; name: string; color?: string };

export interface ManualDue {
  epochMs: number;
  dueString: string;
  display: string | null;
}

export interface AddTaskOverrides {
  project?: boolean;
  priority?: boolean;
  labels?: boolean;
  due?: boolean;
}

export interface AddTaskDraftPreview {
  kind: "deadline";
  title: string;
  dueDate: string;
  dueTime: string | null;
  priority: number | null;
  source: "todoist";
  isEditing: boolean;
  placementChanged: boolean;
}

export interface TodoistReminderEntry {
  id?: string;
  clientId?: string;
  offsetMinutes?: number;
  offset_minutes?: number;
  remindAt?: string;
  status?: ReminderStatus;
  sent?: boolean;
  blocked?: boolean;
  blockReason?: TodoistReminderBlockReason;
}

export type TodoistReminderBlockReason = "duplicate" | "past" | "missing_anchor";

export type TodoistReminderDraftResult = TodoistReminderEntry & (
  | { blocked: true; blockReason: TodoistReminderBlockReason }
  | { blocked: false; clientId: string; offsetMinutes: number; remindAt: string; status: "pending" }
);

export interface TodoistReminderPresetState {
  disabled: boolean;
  reason: TodoistReminderBlockReason | null;
  remindAt: string | null;
}

export interface TodoistReminderChip {
  key: string;
  id: string | null;
  label: string;
  status: ReminderStatus;
  sent: boolean;
  offsetMinutes: number;
  raw: TodoistReminderEntry;
}

export interface TodoistReminderSourceTask {
  id?: string | null;
  title?: string;
  content?: string;
  due_date?: string | null;
  due_time?: string | null;
  class_name?: string;
  class_color?: string | null;
  project_name?: string | null;
  url?: string | null;
}

export interface PanelPosition {
  top?: number;
  left?: number;
  width?: number;
  inline?: boolean;
  modal?: boolean;
  mobile?: boolean;
}

export interface EditMetadataItem {
  id: string;
  text: string;
  color: string;
}

export interface SubmitAddTaskFlowOptions {
  parsed: ParsedTodoistTokensInput;
  resolvedDue: string | null;
  overrides: AddTaskOverrides;
  input: string;
  projects: TodoistProject[];
  labels: TodoistLabel[];
  seededNlpDueDate: string | null;
  seededCreateDue: ManualDue | null;
  description: string;
  resolvedProject: TodoistProject | null;
  resolvedPriority: TodoistPriority;
  resolvedLabels: TodoistLabel[];
  isEdit: boolean;
  editingTask: TodoistEditorTask | null | undefined;
  todoistReminders: TodoistReminderEntry[];
  removedReminderIds: string[];
  committedTask: TodoistTask | null;
  createDeadline: (payload: DeadlineMutationRequest) => Promise<TodoistTask>;
  updateDeadline: (id: string, payload: DeadlineMutationRequest) => Promise<TodoistTask>;
  createReminder: (payload: CreateReminderRequest) => Promise<unknown>;
  deleteReminder: (id: string) => Promise<unknown>;
  parseTokensWithChrono: (
    input: string,
    projects: TodoistProject[],
    labels: TodoistLabel[],
    options?: { seededDueDate?: string | null },
  ) => Promise<ParsedTodoistTokens>;
  isChronoReady: () => boolean;
}

export type TodoistReminder = Reminder | TodoistReminderEntry;
export type CustomReminder = ReminderDateTimeSelection;
export type StateSetter<T> = Dispatch<SetStateAction<T>>;
export type ElementRef<T extends HTMLElement> = MutableRefObject<T | null>;
