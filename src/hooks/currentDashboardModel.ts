import type { ActualBillOccurrence } from "../../shared/types/actual";
import type { BillsMirrorHealth } from "../../shared/types/bills";
import type { NormalizedCalendarEvent } from "../../shared/types/calendar";
import type {
  CurrentDashboardProviderHealth,
  CurrentDashboardResponse,
  CurrentDashboardWeather,
} from "../../shared/types/dashboard";
import type { ActiveSnapshotView } from "../../shared/types/snapshots";
import type { DeadlineOccurrence, DeadlinePayload } from "../../shared/types/tasks";
import type { DashboardClientSystemStatus } from "./currentDashboardHealthModel";

type CalendarSignatureItem = Partial<NormalizedCalendarEvent> & {
  iCalUID?: string;
};

type DeadlineSignatureItem = Partial<Pick<
  DeadlineOccurrence,
  "id" | "due_date" | "due_time" | "_completing"
>> & {
  todoist_id?: string;
  status?: string;
};

export interface CurrentDashboardRefreshState {
  providerHealth?: {
    currentData?: { sources?: Array<{ state?: string; refreshStartedAt?: string | null }> };
    activeSnapshot?: { state?: string; processing?: { active?: boolean } } | null;
  } | null;
  activeSnapshot?: { processing?: { active?: boolean } } | null;
}

export const EMPTY_DEADLINES = {
  upcoming: [],
  stats: null,
} as const;

export interface DashboardBriefingProjection {
  weather: CurrentDashboardWeather | null;
  calendar: NormalizedCalendarEvent[];
  deadlines: DeadlinePayload | typeof EMPTY_DEADLINES;
  emails: { summary: string; accounts: [] };
}

export interface CurrentDashboardLiveDataBulk {
  liveEmails: [];
  liveCalendar: NormalizedCalendarEvent[] | null;
  liveDeadlines: DeadlinePayload | typeof EMPTY_DEADLINES;
  liveNextWeekCalendar: null;
  liveTomorrowCalendar: null;
  liveWeather: CurrentDashboardWeather | null;
  liveBills: ActualBillOccurrence[];
  recentTransactions: [];
  allSchedules: ActualBillOccurrence[];
  payeeMap: Record<string, string>;
  importantSenders: [];
  lastFetched: string | null;
  actualConfigured: boolean;
  actualBudgetUrl: string | null;
  billsSyncHealth: BillsMirrorHealth | null;
  snoozedEntries: [];
  resurfacedEntries: [];
  providerHealth: CurrentDashboardProviderHealth | null;
  systemStatus: DashboardClientSystemStatus | null;
  refreshNow: () => Promise<CurrentDashboardResponse | null>;
}

export interface CurrentDashboardLiveData extends CurrentDashboardLiveDataBulk {
  isPolling: boolean;
  billsLoading: boolean;
}

export function mergeActiveSnapshotIntoCurrent(
  current: CurrentDashboardResponse | null,
  activeSnapshot: ActiveSnapshotView,
): CurrentDashboardResponse | null {
  if (!current || typeof current !== "object") return null;
  return {
    ...current,
    activeSnapshot,
    contentKey: null,
  };
}

// Content signature for a calendar event list. getCurrentDashboard() returns a
// freshly JSON-parsed `calendar` array on every poll/refetch, so its identity
// churns even when nothing changed. This signature lets a caller reuse the prior
// array reference when the contents are equivalent, killing the per-refetch
// effect/setEvents churn downstream (the event shape carries id/startMs/endMs).
export function calendarContentSignature(calendar: unknown): string {
  if (!Array.isArray(calendar)) return calendar == null ? "null" : "invalid";
  let sig = `${calendar.length}`;
  for (const ev of calendar as CalendarSignatureItem[]) {
    const id = ev?.id ?? ev?.iCalUID ?? ev?.htmlLink ?? ev?.openUrl ?? "";
    sig += `|${id}:${ev?.startMs ?? ""}:${ev?.endMs ?? ""}`;
  }
  return sig;
}

// Returns `prev` when its contents match `next` so the reference stays stable
// across refetches that did not actually change the calendar; otherwise `next`.
export function stabilizeCalendar<T extends CalendarSignatureItem>(
  prev: T[] | null,
  next: T[] | null,
): T[] | null {
  if (prev === next) return next;
  if (calendarContentSignature(prev) === calendarContentSignature(next)) return prev;
  return next;
}

// Mirrors calendarContentSignature for the deadlines domain: covers the fields
// that affect rendering (id/due_date/due_time/status/_completing) so a fresh
// `liveDeadlines.upcoming` array from an unchanged poll can reuse the prior
// reference — see currentDashboardModel usage note above.
export function deadlineContentSignature(upcoming: unknown): string {
  if (!Array.isArray(upcoming)) return upcoming == null ? "null" : "invalid";
  let sig = `${upcoming.length}`;
  for (const item of upcoming as DeadlineSignatureItem[]) {
    const id = item?.id ?? item?.todoist_id ?? "";
    sig += `|${id}:${item?.due_date ?? ""}:${item?.due_time ?? ""}:${item?.status ?? ""}:${item?._completing ? 1 : 0}`;
  }
  return sig;
}

// Mirrors stabilizeCalendar for the deadlines domain (see stableCalendarRef in
// useCurrentDashboard.ts for the ref-caching call-site pattern this pairs with).
export function stabilizeDeadlines<T extends DeadlineSignatureItem>(
  prev: T[] | null,
  next: T[] | null,
): T[] | null {
  if (prev === next) return next;
  if (deadlineContentSignature(prev) === deadlineContentSignature(next)) return prev;
  return next;
}

export function hasActiveRefreshWork<T extends CurrentDashboardRefreshState>(current: T | null): boolean {
  const currentSources = current?.providerHealth?.currentData?.sources || [];
  return currentSources.some((source) => source.state === "refreshing"
    || (source.refreshStartedAt != null && Date.now() - Date.parse(source.refreshStartedAt) < 2 * 60_000))
    || current?.providerHealth?.activeSnapshot?.state === "syncing"
    || !!current?.providerHealth?.activeSnapshot?.processing?.active
    || !!current?.activeSnapshot?.processing?.active;
}

export function currentToBriefing(current: CurrentDashboardResponse | null): DashboardBriefingProjection {
  const deadlines = current?.deadlines || EMPTY_DEADLINES;
  return {
    weather: current?.weather || null,
    calendar: current?.calendar || [],
    deadlines,
    emails: { summary: "", accounts: [] },
  };
}

// Bulk live-data projection that depends only on `current` (the parsed payload)
// and the stable `refreshNow` callback. Deliberately excludes the volatile
// poll/loading flags so a caller can memoize this slice on `current` alone and
// keep a stable object reference across loading/refreshing toggles.
export function currentToLiveDataBulk(
  current: CurrentDashboardResponse | null,
  { refreshNow }: { refreshNow: () => Promise<CurrentDashboardResponse | null> },
): CurrentDashboardLiveDataBulk {
  return {
    liveEmails: [],
    liveCalendar: current?.calendar || null,
    liveDeadlines: current?.deadlines || EMPTY_DEADLINES,
    liveNextWeekCalendar: null,
    liveTomorrowCalendar: null,
    liveWeather: current?.weather || null,
    liveBills: current?.bills || [],
    recentTransactions: [],
    allSchedules: current?.allSchedules || [],
    payeeMap: current?.payeeMap || {},
    importantSenders: [],
    lastFetched: current?.fetchedAt || null,
    actualConfigured: !!current?.actualConfigured,
    actualBudgetUrl: current?.actualBudgetUrl || null,
    billsSyncHealth: current?.billsSyncHealth || null,
    snoozedEntries: [],
    resurfacedEntries: [],
    providerHealth: current?.providerHealth || null,
    systemStatus: current?.systemStatus || null,
    refreshNow,
  };
}
