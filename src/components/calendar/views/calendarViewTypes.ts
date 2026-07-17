import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface CalendarWeatherDay {
  dateKey: string;
  high?: number | null;
  low?: number | null;
  icon?: string | null;
  summary?: string;
}

export interface CalendarWeatherData {
  temp?: number | null;
  high?: number | null;
  low?: number | null;
  icon?: string | null;
  summary?: string;
  dailyForecast?: CalendarWeatherDay[];
}

export interface CalendarItemLike {
  [key: string]: unknown;
  id?: unknown;
  key?: unknown;
  iCalUID?: unknown;
  title?: string | null;
  name?: string | null;
  subtitle?: string | null;
  status?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  sourceColor?: string | null;
  color?: string | null;
  markerColor?: string | null;
  agendaDotColor?: string | null;
  agendaSourceColor?: string | null;
  agendaSelectedColor?: string | null;
  agendaDateKey?: string | null;
  agendaItemId?: string | null;
  agendaItemKind?: string | null;
  calendarItemKind?: string | null;
  kind?: string | null;
  type?: string | null;
  isDeadline?: boolean;
  allDay?: boolean;
  startMs?: number | null;
  endMs?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  end_date?: string | null;
  dateKey?: string | null;
  due_date?: string | null;
  dueDate?: string | null;
  due_time?: string | null;
  next_date?: string | null;
  nextDate?: string | null;
  project_name?: string | null;
  class_name?: string | null;
  class_color?: string | null;
  description?: string | null;
  duration?: string | null;
  location?: string | null;
  attendees?: string[];
  eventType?: string | null;
  birthdayProperties?: Record<string, unknown> | null;
  writable?: boolean;
  openUrl?: string | null;
  htmlLink?: string | null;
  is_recurring?: boolean;
  isRecurring?: boolean;
  hasUpcomingReminder?: boolean;
  upcomingReminderCount?: number;
  nextReminderAt?: string | null;
  reminderState?: unknown;
  originalStartTime?: string | null;
  previewSourceKey?: string;
}

export interface CalendarDeadlineOverlay {
  enabled?: boolean;
  showCompleted?: boolean;
  data?: unknown;
  readiness?: { state?: string | null } | null;
}

export interface CalendarViewData {
  events?: CalendarItemLike[];
  deadlineOverlay?: CalendarDeadlineOverlay | null;
  isLoading?: boolean;
  [key: string]: unknown;
}

export interface CalendarCellMeta {
  weather?: CalendarWeatherDay | null;
}

export interface CalendarComputed<TItem extends CalendarItemLike = CalendarItemLike> {
  itemsByDay?: Record<string, TItem[]>;
  itemsByDate?: Record<string, TItem[]>;
  cellMetaByDate?: Record<string, CalendarCellMeta>;
  [key: string]: unknown;
}

export interface CalendarViewComputeInput<TData = CalendarViewData> {
  data?: TData | null;
  viewYear: number;
  viewMonth: number;
  weatherData?: CalendarWeatherData | null;
}

export interface CalendarViewDefinition<
  TData = CalendarViewData,
  TItem extends CalendarItemLike = CalendarItemLike,
  TComputed = CalendarComputed<TItem>,
> {
  [key: string]: unknown;
  compute(input: CalendarViewComputeInput<TData>): TComputed;
  canNavigateBack?(input?: Record<string, unknown>): boolean;
  getVisibleEventCount?(...args: never[]): number;
  renderCellContents(...args: never[]): ReactNode;
  renderDetail(...args: never[]): ReactNode;
  renderFloatingDetail(...args: never[]): ReactNode;
  HeaderExtras?: ComponentType<never>;
  icon?: LucideIcon;
  getDefaultSelectedItemId(...args: never[]): string | null;
  getItemId(item: TItem): unknown;
  matchesItemId(item: TItem, itemId: unknown): boolean;
  label: string;
}
