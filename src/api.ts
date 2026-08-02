import { isDemoMode } from "./demo/config.ts";
import { readSseStream } from "./lib/sseStream";
import { apiFetch } from "./lib/apiFetch";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type {
  AccountId,
  AccountMutationResponse,
  AccountPatchRequest,
  AccountsResponse,
  ApiTokenMetadata,
  PasskeyDeleteResponse,
  PasskeyListResponse,
  PasskeyRegistrationResponse,
  CreateApiTokenResponse,
  GmailAuthUrlResponse,
  ICloudAccountResponse,
} from "../shared/types/accounts.ts";
import type {
  GeocodeResult,
  ImportantSender,
  ProviderModelAvailability,
  ScheduleSkipResponse,
  SettingsMutationResponse,
  SettingsPatchRequest,
  SettingsResponse,
  TriageCacheStatsResponse,
} from "../shared/types/settings.ts";
import type {
  CreateNewsSourceRequest,
  CreateNewsSourceResponse,
  CreateNewsTopicResponse,
  ImportNewsTopicsResponse,
  MarkNewsSeenResponse,
  NewsCatalogResponse,
  NewsMutationResponse,
  NewsPageEnvelope,
  NewsSourcePreview,
  RefreshNewsResponse,
  UpdateNewsSourceRequest,
} from "../shared/types/news.ts";
import type {
  Note,
  NoteId,
  NoteMutationResponse,
} from "../shared/types/notes.ts";
import type {
  CurrentDashboardHealthResponse,
  CurrentDashboardResponse,
} from "../shared/types/dashboard.ts";
import type {
  CreateReminderRequest,
  CreateReminderResponse,
  DiscordReminderTestResponse,
  ReminderListOptions,
  ReminderListResponse,
  ReminderMutationResponse,
} from "../shared/types/reminders.ts";
import type {
  ActualCacheHydrationResponse,
  ActualCacheStatusResponse,
  ActualConnectionOverrides,
  ActualConnectionResponse,
  ActualMetadataResponse,
  BillCandidate,
  BillExtractionInput,
  BillExtractionResponse,
  BillMutationResponse,
  BillPayResolution,
  BillPaySampleRequest,
  BillPaySeedRequest,
  CalendarBillsRangeResponse,
} from "../shared/types/bills.ts";
import type { ActualAccount, ActualCategoryGroup, ActualPayee } from "../shared/types/actual.ts";
import type {
  CalendarDeadlineRangeResponse,
  CompleteDeadlineOccurrenceResult,
  DeadlineDeleteResponse,
  DeadlineMutationRequest,
  DeadlinePayload,
  TodoistLabel,
  TodoistProject,
  TodoistTask,
} from "../shared/types/tasks.ts";
import type { ActiveSnapshotView, SnapshotHistoryResponse, SnapshotItem, SnapshotTriageLane, SnapshotView } from "../shared/types/snapshots.ts";
import type {
  CalendarBatchMutationResponse,
  CalendarDeleteResponse,
  CalendarEventMutationInput,
  CalendarEventMutationResponse,
  CalendarPlaceDetailsResponse,
  CalendarPlaceSuggestionsResponse,
  CalendarRangeResponse,
  CalendarSearchResponse,
  CalendarSourcesResponse,
} from "../shared/types/calendar.ts";
import type {
  EmailArrivalGraceResponse,
  EmailBatchReadResponse,
  EmailBody,
  EmailMutationResponse,
  EmailSearchClientResponse,
  EmailSearchCostStats,
  PinnedEmailSnapshot,
} from "../shared/types/email.ts";
import type {
  AlfredConversationDeleteResponse,
  AlfredRunEvent,
  AlfredStreamOptions,
  AlfredUsageStats,
} from "../shared/types/alfred.ts";
import type { CapabilityStatusResponse } from "../shared/types/capabilities.ts";
import type { InstanceCredentialMetadata, InstanceCredentialMetadataResponse } from "../shared/types/instance-credentials.ts";
export { discardGoogleOAuthPending, discardInstanceCredentialPending } from "./lib/instanceCredentialPendingApi.ts";
export * from "./lib/transactionImportApi.ts";

type ApiId = string | number;
export type AuthResponse = {
  authenticated: boolean;
  demo?: boolean;
  passkeyRequired?: boolean;
  passkeySetupRecommended?: boolean;
};

type CurrentDashboardPrime = {
  promise: Promise<CurrentDashboardResponse>;
  expiresAt: number;
};

type EmailBodyCacheEntry = {
  promise: Promise<EmailBody>;
  expiresAt: number;
  value: EmailBody | null;
};

type CalendarSearchOptions = {
  scope?: string;
  q?: string;
  limit?: number;
  signal?: AbortSignal;
};

type SignalOptions = { signal?: AbortSignal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(value: unknown): string | null {
  const message = isRecord(value) ? value.message : null;
  return message ? String(message) : null;
}

// Auth
export const checkAuth = (): Promise<AuthResponse> => (
  isDemoMode() ? Promise.resolve({ authenticated: true, demo: true }) : apiFetch<AuthResponse>("/api/auth/check")
);
export async function login(password: string): Promise<AuthResponse> {
  if (isDemoMode()) return { authenticated: true, demo: true };

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "Setpoint" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new Error(errorMessage(body) || `API error: ${res.status}`);
  }
  return res.json() as Promise<AuthResponse>;
}
export const getPasskeyAuthenticationOptions = (): Promise<PublicKeyCredentialRequestOptionsJSON> => (
  apiFetch<PublicKeyCredentialRequestOptionsJSON>("/api/auth/passkey/authentication/options", {
    method: "POST",
    redirectOnAuthFailure: false,
  })
);
export const verifyPasskeyAuthentication = (credential: AuthenticationResponseJSON): Promise<AuthResponse> => (
  apiFetch<AuthResponse>("/api/auth/passkey/authentication/verify", {
    method: "POST",
    redirectOnAuthFailure: false,
    body: JSON.stringify(credential),
  })
);
export const cancelPasskeyAuthentication = (): Promise<unknown> => (
  apiFetch("/api/auth/passkey/authentication/cancel", {
    method: "POST",
    redirectOnAuthFailure: false,
  })
);
export const logout = (): Promise<unknown> => apiFetch("/api/auth/logout", { method: "POST" });
export const listPasskeys = (): Promise<PasskeyListResponse> => apiFetch("/api/auth/passkeys");
export const getPasskeyRegistrationOptions = (label: string): Promise<PublicKeyCredentialCreationOptionsJSON> => (
  apiFetch<PublicKeyCredentialCreationOptionsJSON>("/api/auth/passkeys/registration/options", {
    method: "POST",
    redirectOnAuthFailure: false,
    body: JSON.stringify({ label }),
  })
);
export const verifyPasskeyRegistration = (credential: RegistrationResponseJSON & { label: string }): Promise<PasskeyRegistrationResponse> => (
  apiFetch("/api/auth/passkeys/registration/verify", {
    method: "POST",
    redirectOnAuthFailure: false,
    body: JSON.stringify(credential),
  })
);
export const deletePasskeyCredential = (credentialId: ApiId): Promise<PasskeyDeleteResponse> => (
  apiFetch(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
    redirectOnAuthFailure: false,
  })
);
export const listApiTokens = (): Promise<ApiTokenMetadata[]> => apiFetch("/api/auth/api-tokens");
export const createApiToken = (label: string, scopes: string[]): Promise<CreateApiTokenResponse> => apiFetch("/api/auth/api-tokens", { method: "POST", body: JSON.stringify({ label, scopes }) });
export const revokeApiToken = (id: ApiId): Promise<AccountMutationResponse> => apiFetch(`/api/auth/api-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
// Current snapshot and operational dashboard data
export const getActiveSnapshot = (): Promise<ActiveSnapshotView> => apiFetch("/api/briefing/snapshot/active");
export const syncActiveSnapshot = (): Promise<ActiveSnapshotView> => apiFetch("/api/briefing/snapshot/sync", { method: "POST" });
export const getSnapshotHistory = (): Promise<SnapshotHistoryResponse> => apiFetch("/api/briefing/snapshot/history");
export const getSnapshotById = (id: ApiId): Promise<SnapshotView> => apiFetch(`/api/briefing/snapshot/${encodeURIComponent(id)}`);
export const moveSnapshotItemLane = (itemId: ApiId, lane: SnapshotTriageLane): Promise<SnapshotItem> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/lane`, {
    method: "PATCH",
    body: JSON.stringify({ lane }),
  });
export const dismissSnapshotItemForToday = (itemId: ApiId): Promise<SnapshotItem> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/dismiss`, { method: "POST" });
export const restoreSnapshotItemForToday = (itemId: ApiId): Promise<SnapshotItem> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/restore`, { method: "POST" });
export const markSnapshotItemHandled = (itemId: ApiId): Promise<SnapshotItem> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/handled`, { method: "POST" });
export const reopenSnapshotItem = (itemId: ApiId): Promise<SnapshotItem> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/reopen`, { method: "POST" });

// Current Dashboard
// Single-use prime for the cold-start dashboard load. The auth-gated App-shell
// prefetch (App.tsx) and useCurrentDashboard's mount fetch must collapse to ONE
// /api/dashboard/current request instead of firing two. Only the first load
// consumes the prime; every later poll / event-refetch / reload goes straight to
// the network, so steady-state behavior is unchanged. The TTL is a safety expiry
// for a prime that is never consumed (e.g. the user navigates away before mount).
const CURRENT_DASHBOARD_PRIME_TTL_MS = 10 * 1000;
let currentDashboardPrime: CurrentDashboardPrime | null = null;
// Fire-and-forget warm of the cold-start dashboard fetch. The caller (App.tsx)
// only invokes this once auth is confirmed, so it never runs on an unauthenticated
// session. Demo mode never reaches here (App returns early), and apiFetch routes
// any demo request through the demo adapter regardless.
export const prefetchCurrentDashboard = (): void => {
  const now = Date.now();
  if (currentDashboardPrime && currentDashboardPrime.expiresAt > now) return;
  const promise = apiFetch<CurrentDashboardResponse>("/api/dashboard/current");
  const entry = { promise, expiresAt: now + CURRENT_DASHBOARD_PRIME_TTL_MS };
  // Swallow the rejection on this handle so an unconsumed prefetch never becomes
  // an unhandledrejection, and drop the prime on failure so the real load fetches
  // fresh rather than inheriting the prefetch error (mirrors getEmailBody).
  promise.catch(() => {
    if (currentDashboardPrime === entry) currentDashboardPrime = null;
  });
  currentDashboardPrime = entry;
};
export const getCurrentDashboard = (): Promise<CurrentDashboardResponse> => {
  const prime = currentDashboardPrime;
  currentDashboardPrime = null; // single-use: consume or discard on first read
  if (prime && prime.expiresAt > Date.now()) return prime.promise;
  return apiFetch("/api/dashboard/current");
};
export const getDashboardHealth = (): Promise<CurrentDashboardHealthResponse> => apiFetch("/api/dashboard/health");
export const requestCurrentDashboardRefresh = (): Promise<CurrentDashboardResponse> => apiFetch("/api/dashboard/current/refresh", { method: "POST" });
export const syncCurrentDashboard = (): Promise<CurrentDashboardResponse> => apiFetch("/api/dashboard/current/sync", { method: "POST" });
export const getTriageCacheStats = (): Promise<TriageCacheStatsResponse> => apiFetch("/api/ea/triage/cache-stats");

export const getAlfredUsageStats = (): Promise<AlfredUsageStats> => apiFetch("/api/alfred/usage");

export const getEmailSearchStats = (): Promise<EmailSearchCostStats> => apiFetch("/api/ea/email-search/usage");
// 5-minute in-memory TTL cache for email bodies. Bodies don't mutate
// server-side once delivered; the cache eliminates the loading flicker on
// re-selection and dedupes concurrent fetches for the same uid.
const EMAIL_BODY_TTL_MS = 5 * 60 * 1000;
// Bound the cache so a long-lived tab can't accumulate full HTML bodies for
// every distinct email ever opened. The TTL was previously only consulted
// lazily on read, so entries for uids that were never re-opened lived forever.
const EMAIL_BODY_CACHE_MAX = 50;
const emailBodyCache = new Map<string, EmailBodyCacheEntry>();
// Sweep expired entries, then evict least-recently-inserted entries until the
// cache is under cap. Map iteration order is insertion order, so the first key
// is the oldest. Called on every insert — O(n) sweep is trivial at this scale.
function pruneEmailBodyCache(now: number): void {
  for (const [key, entry] of emailBodyCache) {
    if (entry.expiresAt <= now) emailBodyCache.delete(key);
  }
  while (emailBodyCache.size > EMAIL_BODY_CACHE_MAX) {
    const oldest = emailBodyCache.keys().next().value;
    if (oldest === undefined) break;
    emailBodyCache.delete(oldest);
  }
}
export const getEmailBody = (uid: string): Promise<EmailBody> => {
  const now = Date.now();
  const hit = emailBodyCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.value ? Promise.resolve(hit.value) : hit.promise;
  const promise = apiFetch<EmailBody>(`/api/briefing/email/${encodeURIComponent(uid)}`)
    .then((value) => {
      emailBodyCache.set(uid, { promise, value, expiresAt: Date.now() + EMAIL_BODY_TTL_MS });
      pruneEmailBodyCache(Date.now());
      return value;
    })
    .catch((err) => {
      // Don't poison the cache on failure — let the next call retry.
      emailBodyCache.delete(uid);
      throw err;
    });
  emailBodyCache.set(uid, { promise, value: null, expiresAt: now + EMAIL_BODY_TTL_MS });
  pruneEmailBodyCache(now);
  return promise;
};
export const peekEmailBody = (uid: string): EmailBody | null => {
  const hit = emailBodyCache.get(uid);
  return hit && hit.value && hit.expiresAt > Date.now() ? hit.value : null;
};
export const dismissEmail = (emailId: ApiId): Promise<EmailMutationResponse> => apiFetch(`/api/briefing/dismiss/${encodeURIComponent(emailId)}`, { method: "POST" });
export const snoozeEmail = (uid: string, untilTs: number, snapshot: PinnedEmailSnapshot | null = null): Promise<EmailMutationResponse> =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/snooze`, {
    method: "POST",
    body: JSON.stringify({ until_ts: untilTs, snapshot }),
  });
export const unsnoozeEmail = (uid: string): Promise<EmailMutationResponse> =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/snooze`, { method: "DELETE" });
export const pinEmail = (uid: string, snapshot: PinnedEmailSnapshot | null = null): Promise<EmailMutationResponse> =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/pin`, {
    method: "POST",
    body: JSON.stringify({ snapshot }),
  });
export const unpinEmail = (uid: string): Promise<EmailMutationResponse> =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/pin`, { method: "DELETE" });
export const completeTask = (taskId: ApiId): Promise<unknown> => apiFetch(`/api/briefing/complete-task/${encodeURIComponent(taskId)}`, { method: "POST" });
export const dismissTombstone = (todoistId: ApiId): Promise<unknown> =>
  apiFetch(`/api/briefing/tombstone/${encodeURIComponent(todoistId)}`, { method: "DELETE" });
export const markEmailAsRead = (uid: string): Promise<EmailMutationResponse> => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/mark-read`, { method: "POST" });
export const markEmailAsUnread = (uid: string): Promise<EmailMutationResponse> => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/mark-unread`, { method: "POST" });
export const trashEmail = (uid: string): Promise<EmailMutationResponse> => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/trash`, { method: "POST" });
export const trashEmailOnExit = (uid: string): void => {
  if (isDemoMode()) return;

  const path = `/api/briefing/email/${encodeURIComponent(uid)}/trash`;
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const body = new Blob(["{}"], { type: "application/json" });
    if (navigator.sendBeacon(path, body)) return;
  }
  fetch(path, {
    method: "POST",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Setpoint",
    },
    body: "{}",
  }).catch(() => {});
};
export const markAllEmailsAsRead = (uids: string[]): Promise<EmailBatchReadResponse> => apiFetch("/api/briefing/email/mark-all-read", { method: "POST", body: JSON.stringify({ uids }) });
export const settleArrivalGrace = (): Promise<EmailArrivalGraceResponse> => apiFetch("/api/briefing/email/arrival-grace/settle", { method: "POST" });
export const settleArrivalGraceOnExit = (): void => {
  if (isDemoMode()) return;

  const path = "/api/briefing/email/arrival-grace/settle";
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const body = new Blob(["{}"], { type: "application/json" });
    if (navigator.sendBeacon(path, body)) return;
  }
  fetch(path, {
    method: "POST",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Setpoint",
    },
    body: "{}",
  }).catch(() => {});
};
// Calendar
function unwrapDeadlineMutationResult<T>(result: T | { deadline: T }): T {
  return isRecord(result) && "deadline" in result ? result.deadline as T : result as T;
}

export const getCalendarDeadlines = (): Promise<DeadlinePayload> => apiFetch("/api/calendar/deadlines");
export const getCalendarDeadlinesRange = (start: string, end: string): Promise<CalendarDeadlineRangeResponse> =>
  apiFetch(`/api/calendar/deadlines/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
export const createDeadline = (data: DeadlineMutationRequest): Promise<TodoistTask> =>
  apiFetch<TodoistTask | { deadline: TodoistTask }>("/api/calendar/deadlines", { method: "POST", body: JSON.stringify(data) })
    .then(unwrapDeadlineMutationResult);
export const updateDeadline = (id: ApiId, data: DeadlineMutationRequest): Promise<TodoistTask> =>
  apiFetch<TodoistTask | { deadline: TodoistTask }>(`/api/calendar/deadlines/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) })
    .then(unwrapDeadlineMutationResult);
export const deleteDeadline = (id: ApiId): Promise<DeadlineDeleteResponse> =>
  apiFetch(`/api/calendar/deadlines/${encodeURIComponent(id)}`, { method: "DELETE" });
export const completeDeadlineOccurrence = (id: ApiId, occurrenceDate: string): Promise<CompleteDeadlineOccurrenceResult> =>
  apiFetch(
    `/api/calendar/deadlines/${encodeURIComponent(id)}/completed-occurrences/${encodeURIComponent(occurrenceDate)}`,
    { method: "POST" },
  );
export const getCalendarBillsRange = (start: string, end: string): Promise<CalendarBillsRangeResponse> =>
  apiFetch(`/api/calendar/bills/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
export const getCalendarSearch = ({ scope, q, limit, signal }: CalendarSearchOptions = {}): Promise<CalendarSearchResponse> => {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (q) params.set("q", q);
  if (limit) params.set("limit", String(limit));
  return apiFetch(`/api/calendar/search?${params.toString()}`, { signal });
};
// Calendar range fetch — used by useCalendarRange hook
export const getCalendarRange = (start: string, end: string, { signal }: SignalOptions = {}): Promise<CalendarRangeResponse> =>
  apiFetch(`/api/calendar/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { signal });
export const getCalendarSources = (): Promise<CalendarSourcesResponse> => apiFetch("/api/calendar/calendars");
export const getCalendarPlaceSuggestions = (query: string, sessionToken?: string): Promise<CalendarPlaceSuggestionsResponse> =>
  apiFetch(`/api/calendar/places/suggest?q=${encodeURIComponent(query)}${sessionToken ? `&sessionToken=${encodeURIComponent(sessionToken)}` : ""}`);
export const getCalendarPlaceDetails = (placeId: string, sessionToken?: string): Promise<CalendarPlaceDetailsResponse> =>
  apiFetch(`/api/calendar/places/${encodeURIComponent(placeId)}${sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ""}`);
// Client-side deadline for calendar write mutations so a stalled request always
// settles (see apiFetch). 60s deliberately clears the server's own worst case —
// a 30s Google budget + 10s token refresh, and up to 4 chained Google calls on
// recurring "following" flows — so a slow-but-succeeding server write is not
// aborted into an inverse ghost. Reads/SSE intentionally opt out.
const CALENDAR_MUTATION_TIMEOUT_MS = 60_000;
export const createCalendarEvent = (data: CalendarEventMutationInput): Promise<CalendarEventMutationResponse> =>
  apiFetch("/api/calendar/events", { method: "POST", body: JSON.stringify(data), timeoutMs: CALENDAR_MUTATION_TIMEOUT_MS });
export const createCalendarEventsBatch = (items: CalendarEventMutationInput[]): Promise<CalendarBatchMutationResponse> =>
  apiFetch("/api/calendar/events/batch", { method: "POST", body: JSON.stringify({ items }), timeoutMs: CALENDAR_MUTATION_TIMEOUT_MS });
export const updateCalendarEvent = (eventId: ApiId, data: CalendarEventMutationInput): Promise<CalendarEventMutationResponse> =>
  apiFetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: JSON.stringify(data), timeoutMs: CALENDAR_MUTATION_TIMEOUT_MS });
export const deleteCalendarEvent = (eventId: ApiId, data: CalendarEventMutationInput): Promise<CalendarDeleteResponse> =>
  apiFetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, { method: "DELETE", body: JSON.stringify(data), timeoutMs: CALENDAR_MUTATION_TIMEOUT_MS });

// Todoist
export const getTodoistProjects = (): Promise<TodoistProject[]> => apiFetch("/api/briefing/todoist/projects");
export const getTodoistLabels = (): Promise<TodoistLabel[]> => apiFetch("/api/briefing/todoist/labels");
export const saveTodoistPersonalToken = (token: string): Promise<{ success: true; verifiedAt: string }> => apiFetch("/api/ea/accounts/todoist/personal-token", {
  method: "POST",
  body: JSON.stringify({ token }),
});
export const disconnectTodoistConnection = (): Promise<{ success: true }> => apiFetch("/api/ea/accounts/todoist/connection", { method: "DELETE" });
export const createTodoistTask = (data: DeadlineMutationRequest): Promise<TodoistTask> => apiFetch("/api/briefing/todoist/tasks", { method: "POST", body: JSON.stringify(data) });
export const updateTodoistTask = (id: ApiId, data: DeadlineMutationRequest): Promise<TodoistTask> => apiFetch(`/api/briefing/todoist/tasks/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(data) });
export const deleteTodoistTask = (id: ApiId): Promise<DeadlineDeleteResponse> => apiFetch(`/api/briefing/todoist/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });

// Actual Budget
export const sendToActualBudget = (bill: BillCandidate): Promise<BillMutationResponse> => apiFetch("/api/briefing/actual/send", { method: "POST", body: JSON.stringify(bill) });
export const extractBillFromEmail = ({ subject, from, body }: BillExtractionInput): Promise<BillExtractionResponse> => apiFetch("/api/briefing/bills/extract", { method: "POST", body: JSON.stringify({ subject, from, body }) });
export const resolveBillPaySeed = (payload: BillPaySeedRequest): Promise<BillPayResolution> => apiFetch("/api/briefing/bills/resolve", { method: "POST", body: JSON.stringify(payload || {}) });
export const resolveBillPayMappingSample = (payload: BillPaySampleRequest): Promise<BillPayResolution> => apiFetch("/api/briefing/bills/resolve-sample", { method: "POST", body: JSON.stringify(payload || {}) });
export const markBillPaid = (id: ApiId): Promise<BillMutationResponse> => apiFetch(`/api/briefing/actual/bills/${encodeURIComponent(id)}/mark-paid`, { method: "POST" });
export const getActualAccounts = (): Promise<ActualAccount[]> => apiFetch("/api/briefing/actual/accounts");
export const getActualPayees = (): Promise<ActualPayee[]> => apiFetch("/api/briefing/actual/payees");
export const getActualCategories = (): Promise<ActualCategoryGroup[]> => apiFetch("/api/briefing/actual/categories");
export const getActualMetadata = (): Promise<ActualMetadataResponse> => apiFetch("/api/briefing/actual/metadata");
export const testActualBudget = (overrides: ActualConnectionOverrides | null): Promise<ActualConnectionResponse> => apiFetch("/api/briefing/actual/test", { method: "POST", body: JSON.stringify(overrides || {}) });
export const saveActualBudgetConnection = (candidate: ActualConnectionOverrides): Promise<ActualConnectionResponse> => apiFetch("/api/briefing/actual/connection", {
  method: "POST",
  body: JSON.stringify(candidate),
});
export const removeActualBudgetConnection = (): Promise<{ success: true }> => apiFetch("/api/briefing/actual/connection", { method: "DELETE" });
export const getActualCacheStatus = (): Promise<ActualCacheStatusResponse> => apiFetch("/api/briefing/actual/cache/status");
export const hydrateActualBudgetCache = (): Promise<ActualCacheHydrationResponse> => apiFetch("/api/briefing/actual/cache/hydrate", { method: "POST" });

// Accounts & Settings
export const getAccounts = (): Promise<AccountsResponse> => apiFetch("/api/ea/accounts");
export const getGmailAuthUrl = (): Promise<GmailAuthUrlResponse> => apiFetch("/api/ea/accounts/gmail/auth");
export const addICloudAccount = (email: string, password: string): Promise<ICloudAccountResponse> => apiFetch("/api/ea/accounts/icloud", { method: "POST", body: JSON.stringify({ email, password }) });
export const updateAccount = (id: ApiId, data: AccountPatchRequest): Promise<AccountMutationResponse> => apiFetch(`/api/ea/accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
export const removeAccount = (id: ApiId): Promise<AccountMutationResponse> => apiFetch(`/api/ea/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderAccounts = (order: AccountId[]): Promise<AccountMutationResponse> => apiFetch("/api/ea/accounts/reorder", { method: "PATCH", body: JSON.stringify({ order }) });
export const getSettings = (): Promise<SettingsResponse> => apiFetch("/api/ea/settings");
export const getCapabilities = (refresh = false): Promise<CapabilityStatusResponse> => (
  apiFetch(`/api/capabilities${refresh ? "?refresh=1" : ""}`)
);
export const getInstanceCredentials = (): Promise<InstanceCredentialMetadataResponse> => apiFetch("/api/instance-credentials");
export const stageInstanceCredential = (key: string, value: string): Promise<InstanceCredentialMetadata> =>
  apiFetch(`/api/instance-credentials/${encodeURIComponent(key)}/pending`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
export const testInstanceCredential = (key: string): Promise<{
  ok: boolean;
  code: string;
  metadata: InstanceCredentialMetadata;
}> => apiFetch(`/api/instance-credentials/${encodeURIComponent(key)}/test`, { method: "POST" });
export const importInstanceCredentialEnvironment = (key: string): Promise<InstanceCredentialMetadata> =>
  apiFetch(`/api/instance-credentials/${encodeURIComponent(key)}/import-environment`, { method: "POST" });
export const disableInstanceCredential = (key: string): Promise<InstanceCredentialMetadata> =>
  apiFetch(`/api/instance-credentials/${encodeURIComponent(key)}/disable`, { method: "POST" });
export const useHostInstanceCredential = (key: string): Promise<InstanceCredentialMetadata> =>
  apiFetch(`/api/instance-credentials/${encodeURIComponent(key)}/use-host`, { method: "POST" });
export const stageGoogleOAuthApplication = (clientId: string, clientSecret: string): Promise<{
  credentials: InstanceCredentialMetadata[];
  candidateVersions: { clientId: number; clientSecret: number };
}> => apiFetch("/api/instance-credentials/google-oauth/pending", {
  method: "PUT",
  body: JSON.stringify({ clientId, clientSecret }),
});
export const importGoogleOAuthEnvironment = (): Promise<{ credentials: InstanceCredentialMetadata[] }> => apiFetch("/api/instance-credentials/google-oauth/import-environment", { method: "POST" });
export const disableGoogleOAuthApplication = (): Promise<{ credentials: InstanceCredentialMetadata[] }> => apiFetch("/api/instance-credentials/google-oauth/disable", { method: "POST" });
export const useHostGoogleOAuthApplication = (): Promise<{ credentials: InstanceCredentialMetadata[] }> => apiFetch("/api/instance-credentials/google-oauth/use-host", { method: "POST" });
export const updateSettings = (data: SettingsPatchRequest): Promise<SettingsMutationResponse> => apiFetch("/api/ea/settings", { method: "PUT", body: JSON.stringify(data) });
export const testDiscordReminderWebhook = (): Promise<DiscordReminderTestResponse> => apiFetch("/api/ea/settings/discord-reminder-test", { method: "POST" });
export const listReminders = ({ sourceType, sourceItemId, sourceOccurrenceId }: ReminderListOptions = {}): Promise<ReminderListResponse> => {
  const params = new URLSearchParams();
  if (sourceType) params.set("sourceType", sourceType);
  if (sourceItemId) params.set("sourceItemId", sourceItemId);
  if (sourceOccurrenceId) params.set("sourceOccurrenceId", sourceOccurrenceId);
  return apiFetch(`/api/ea/reminders?${params.toString()}`);
};
export const createReminder = (data: CreateReminderRequest): Promise<CreateReminderResponse> => apiFetch("/api/ea/reminders", { method: "POST", body: JSON.stringify(data) });
export const deleteReminder = (id: ApiId): Promise<ReminderMutationResponse> => apiFetch(`/api/ea/reminders/${encodeURIComponent(id)}`, { method: "DELETE" });
export const geocodeLocation = (q: string): Promise<GeocodeResult[]> => apiFetch(`/api/ea/geocode?q=${encodeURIComponent(q)}`);
export const skipSchedule = (index: number, skip = true): Promise<ScheduleSkipResponse> => apiFetch("/api/ea/schedules/skip", { method: "POST", body: JSON.stringify({ index, skip }) });
export const getModels = (): Promise<ProviderModelAvailability[]> => apiFetch("/api/ea/models");
export const getBillExtractModels = (): Promise<ProviderModelAvailability[]> => apiFetch("/api/ea/bill-extract-models");
export const getAlfredModels = (): Promise<ProviderModelAvailability[]> => apiFetch("/api/ea/alfred-models");

export const searchEmails = (query: string, limit?: string | number, { signal }: SignalOptions = {}): Promise<EmailSearchClientResponse> => {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set("limit", String(limit));
  return apiFetch(`/api/briefing/email-search?${params}`, { signal });
};

// Alfred — streaming run + conversation reset. Not apiFetch: the response is
// an SSE stream, not JSON.
export async function runAlfredStream({ message, conversationId, signal, onEvent }: AlfredStreamOptions): Promise<void> {
  if (isDemoMode()) {
    throw new Error("Alfred is not available in the demo");
  }
  const res = await fetch("/api/alfred/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Setpoint",
    },
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversationId } : {}),
    }),
    ...(signal ? { signal } : {}),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new Error(errorMessage(body) || `API error: ${res.status}`);
  }
  await readSseStream(res.body as ReadableStream<Uint8Array>, (payload) => onEvent(payload as AlfredRunEvent));
}

export const deleteAlfredConversation = (id: ApiId): Promise<AlfredConversationDeleteResponse> => (
  apiFetch(`/api/alfred/conversations/${encodeURIComponent(id)}`, { method: "DELETE" })
);

// Important Senders
export const getImportantSenders = (): Promise<ImportantSender[]> => apiFetch("/api/ea/important-senders");
export const updateImportantSenders = (senders: ImportantSender[]): Promise<SettingsMutationResponse> => apiFetch("/api/ea/important-senders", { method: "PUT", body: JSON.stringify({ senders }) });

// Notes
export const getNotes = (): Promise<Note[]> => apiFetch("/api/notes");
export const createNote = (content: string): Promise<Note> => apiFetch("/api/notes", { method: "POST", body: JSON.stringify({ content }) });
export const updateNote = (id: NoteId, content: string): Promise<NoteMutationResponse> => apiFetch(`/api/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ content }) });
export const deleteNote = (id: NoteId): Promise<NoteMutationResponse> => apiFetch(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderNotes = (noteIds: NoteId[]): Promise<NoteMutationResponse> => apiFetch("/api/notes/reorder", { method: "PATCH", body: JSON.stringify({ noteIds }) });
export const archiveNote = (id: NoteId, archived: boolean): Promise<NoteMutationResponse> =>
  apiFetch(`/api/notes/${encodeURIComponent(id)}/archive`, { method: "PATCH", body: JSON.stringify({ archived }) });

// News
export const getNews = (): Promise<NewsPageEnvelope> => apiFetch("/api/news");
export const getNewsCatalog = (): Promise<NewsCatalogResponse> => apiFetch("/api/news/catalog");
export const markNewsSeen = (at: string): Promise<MarkNewsSeenResponse> =>
  apiFetch("/api/news/seen", { method: "POST", body: JSON.stringify({ at }) });
export const refreshNews = (): Promise<RefreshNewsResponse> => apiFetch("/api/news/refresh", { method: "POST" });
export const createNewsTopic = (name: string): Promise<CreateNewsTopicResponse> =>
  apiFetch("/api/news/topics", { method: "POST", body: JSON.stringify({ name }) });
export const renameNewsTopic = (id: ApiId, name: string): Promise<NewsMutationResponse> =>
  apiFetch(`/api/news/topics/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
export const updateNewsTopicMutedTerms = (id: ApiId, mutedTerms: string[]): Promise<NewsMutationResponse> =>
  apiFetch(`/api/news/topics/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ mutedTerms }) });
export const reorderNewsTopics = (ids: ApiId[]): Promise<NewsMutationResponse> =>
  apiFetch("/api/news/topics/reorder", { method: "POST", body: JSON.stringify({ ids }) });
export const deleteNewsTopic = (id: ApiId): Promise<NewsMutationResponse> =>
  apiFetch(`/api/news/topics/${encodeURIComponent(id)}`, { method: "DELETE" });
export const importNewsStarterTopics = (names: string[]): Promise<ImportNewsTopicsResponse> =>
  apiFetch("/api/news/topics/import-starter", { method: "POST", body: JSON.stringify({ names }) });
export const previewNewsSource = (url: string): Promise<NewsSourcePreview> =>
  apiFetch("/api/news/sources/preview", { method: "POST", body: JSON.stringify({ url }) });
export const createNewsSource = (data: CreateNewsSourceRequest): Promise<CreateNewsSourceResponse> =>
  apiFetch("/api/news/sources", { method: "POST", body: JSON.stringify(data) });
export const updateNewsSource = (id: ApiId, data: UpdateNewsSourceRequest): Promise<NewsMutationResponse> =>
  apiFetch(`/api/news/sources/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteNewsSource = (id: ApiId): Promise<NewsMutationResponse> =>
  apiFetch(`/api/news/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
