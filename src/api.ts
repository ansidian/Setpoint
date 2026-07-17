import { isDemoMode } from "./demo/config.js";
import { readSseStream } from "./lib/sseStream";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

type ApiId = string | number;
type ApiFetchOptions = RequestInit & {
  redirectOnAuthFailure?: boolean;
  timeoutMs?: number;
};
type ApiError = Error & {
  code?: unknown;
  status?: number;
};
type DemoApiRequestHandler = (path: string, options: ApiFetchOptions) => Promise<unknown>;

export type AuthResponse = {
  authenticated: boolean;
  demo?: boolean;
  passkeyRequired?: boolean;
  passkeySetupRecommended?: boolean;
};

type CurrentDashboardPrime = {
  promise: Promise<unknown>;
  expiresAt: number;
};

type EmailBodyCacheEntry = {
  promise: Promise<unknown>;
  expiresAt: number;
  value: unknown | null;
};

type CalendarSearchOptions = {
  scope?: string;
  q?: string;
  limit?: number;
  signal?: AbortSignal;
};

type SignalOptions = { signal?: AbortSignal };

type ReminderListOptions = {
  sourceType?: string;
  sourceItemId?: string;
  sourceOccurrenceId?: string;
};

type AlfredStreamOptions = {
  message: string;
  conversationId?: string;
  model?: string;
  signal?: AbortSignal;
  onEvent: (event: unknown) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(value: unknown): string | null {
  const message = isRecord(value) ? value.message : null;
  return message ? String(message) : null;
}

function errorCode(value: unknown): unknown {
  return isRecord(value) ? (value.code || null) : null;
}

async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  // Keep this literal env check: Vite must eliminate the adapter import from production builds.
  if (import.meta.env.VITE_EA_DEMO === "1") {
    const demoModule = await import("./demo/apiAdapter.js");
    const handleDemoApiRequest = demoModule.handleDemoApiRequest as DemoApiRequestHandler;
    return handleDemoApiRequest(path, options) as Promise<T>;
  }
  const { redirectOnAuthFailure = true, timeoutMs, ...fetchOptions } = options;

  // A request that never settles (stalled TCP, dead network) would otherwise
  // leave an optimistic mutation applied forever with no revert path — the
  // 2026-07-06 calendar ghost-delete incident. When timeoutMs is set we arm an
  // AbortSignal.timeout so fetch rejects, and the rejection flows to the caller's
  // catch (which reverts). Only opted-in helpers pass timeoutMs — SSE streams and
  // long snapshot reads must not inherit a deadline. No current timeoutMs caller
  // also supplies options.signal, so timeoutMs simply provides the signal; if that
  // ever changes, compose the two via AbortSignal.any here.
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : fetchOptions.signal;

  let res;
  try {
    res = await fetch(path, {
      ...fetchOptions,
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Setpoint",
        ...(fetchOptions.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    // AbortSignal.timeout rejects the fetch with a TimeoutError; translate it into
    // a settled, caller-friendly error. A caller-supplied AbortController abort
    // surfaces as AbortError and is left untouched — search cancellation depends
    // on seeing AbortError (see the calendar search abort flow).
    if (timeoutMs && isRecord(err) && err.name === "TimeoutError") {
      const timeoutErr = new Error(
        "Request timed out — check the calendar before retrying; the change may not have saved.",
      );
      (timeoutErr as ApiError).code = "request_timeout";
      throw timeoutErr;
    }
    throw err;
  }

  if (res.status === 401 && redirectOnAuthFailure) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const error = new Error(errorMessage(body) || `API error: ${res.status}`) as ApiError;
    error.code = errorCode(body);
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
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
export const listPasskeys = (): Promise<unknown> => apiFetch("/api/auth/passkeys");
export const getPasskeyRegistrationOptions = (label: string): Promise<PublicKeyCredentialCreationOptionsJSON> => (
  apiFetch<PublicKeyCredentialCreationOptionsJSON>("/api/auth/passkeys/registration/options", {
    method: "POST",
    redirectOnAuthFailure: false,
    body: JSON.stringify({ label }),
  })
);
export const verifyPasskeyRegistration = (credential: RegistrationResponseJSON): Promise<unknown> => (
  apiFetch("/api/auth/passkeys/registration/verify", {
    method: "POST",
    redirectOnAuthFailure: false,
    body: JSON.stringify(credential),
  })
);
export const deletePasskeyCredential = (credentialId: ApiId): Promise<unknown> => (
  apiFetch(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
    redirectOnAuthFailure: false,
  })
);
export const listApiTokens = (): Promise<unknown> => apiFetch("/api/auth/api-tokens");
export const createApiToken = (label: string, scopes: unknown): Promise<unknown> => apiFetch("/api/auth/api-tokens", { method: "POST", body: JSON.stringify({ label, scopes }) });
export const revokeApiToken = (id: ApiId): Promise<unknown> => apiFetch(`/api/auth/api-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });

// Current snapshot and operational dashboard data
export const getActiveSnapshot = (): Promise<unknown> => apiFetch("/api/briefing/snapshot/active");
export const syncActiveSnapshot = (): Promise<unknown> => apiFetch("/api/briefing/snapshot/sync", { method: "POST" });
export const getSnapshotHistory = (): Promise<unknown> => apiFetch("/api/briefing/snapshot/history");
export const getSnapshotById = (id: ApiId): Promise<unknown> => apiFetch(`/api/briefing/snapshot/${encodeURIComponent(id)}`);
export const moveSnapshotItemLane = (itemId: ApiId, lane: string): Promise<unknown> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/lane`, {
    method: "PATCH",
    body: JSON.stringify({ lane }),
  });
export const dismissSnapshotItemForToday = (itemId: ApiId): Promise<unknown> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/dismiss`, { method: "POST" });
export const restoreSnapshotItemForToday = (itemId: ApiId): Promise<unknown> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/restore`, { method: "POST" });
export const markSnapshotItemHandled = (itemId: ApiId): Promise<unknown> =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/handled`, { method: "POST" });
export const reopenSnapshotItem = (itemId: ApiId): Promise<unknown> =>
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
  const promise = apiFetch("/api/dashboard/current");
  const entry = { promise, expiresAt: now + CURRENT_DASHBOARD_PRIME_TTL_MS };
  // Swallow the rejection on this handle so an unconsumed prefetch never becomes
  // an unhandledrejection, and drop the prime on failure so the real load fetches
  // fresh rather than inheriting the prefetch error (mirrors getEmailBody).
  promise.catch(() => {
    if (currentDashboardPrime === entry) currentDashboardPrime = null;
  });
  currentDashboardPrime = entry;
};
export const getCurrentDashboard = (): Promise<unknown> => {
  const prime = currentDashboardPrime;
  currentDashboardPrime = null; // single-use: consume or discard on first read
  if (prime && prime.expiresAt > Date.now()) return prime.promise;
  return apiFetch("/api/dashboard/current");
};
export const getDashboardHealth = (): Promise<unknown> => apiFetch("/api/dashboard/health");
export const requestCurrentDashboardRefresh = (): Promise<unknown> => apiFetch("/api/dashboard/current/refresh", { method: "POST" });
export const syncCurrentDashboard = (): Promise<unknown> => apiFetch("/api/dashboard/current/sync", { method: "POST" });
export const getTriageCacheStats = (): Promise<unknown> => apiFetch("/api/ea/triage/cache-stats");

export const getAlfredUsageStats = (): Promise<unknown> => apiFetch("/api/alfred/usage");

export const getEmailSearchStats = (): Promise<unknown> => apiFetch("/api/ea/email-search/usage");
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
export const getEmailBody = (uid: string): Promise<unknown> => {
  const now = Date.now();
  const hit = emailBodyCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.value ? Promise.resolve(hit.value) : hit.promise;
  const promise = apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}`)
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
export const peekEmailBody = (uid: string): unknown | null => {
  const hit = emailBodyCache.get(uid);
  return hit && hit.value && hit.expiresAt > Date.now() ? hit.value : null;
};
export const dismissEmail = (emailId: ApiId): Promise<unknown> => apiFetch(`/api/briefing/dismiss/${encodeURIComponent(emailId)}`, { method: "POST" });
export const snoozeEmail = (uid: string, untilTs: number, snapshot: unknown = null): Promise<unknown> =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/snooze`, {
    method: "POST",
    body: JSON.stringify({ until_ts: untilTs, snapshot }),
  });
export const unsnoozeEmail = (uid: string): Promise<unknown> =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/snooze`, { method: "DELETE" });
export const pinEmail = (uid: string, snapshot: unknown = null): Promise<unknown> =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/pin`, {
    method: "POST",
    body: JSON.stringify({ snapshot }),
  });
export const unpinEmail = (uid: string): Promise<unknown> =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/pin`, { method: "DELETE" });
export const completeTask = (taskId: ApiId): Promise<unknown> => apiFetch(`/api/briefing/complete-task/${encodeURIComponent(taskId)}`, { method: "POST" });
export const dismissTombstone = (todoistId: ApiId): Promise<unknown> =>
  apiFetch(`/api/briefing/tombstone/${encodeURIComponent(todoistId)}`, { method: "DELETE" });
export const markEmailAsRead = (uid: string): Promise<unknown> => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/mark-read`, { method: "POST" });
export const markEmailAsUnread = (uid: string): Promise<unknown> => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/mark-unread`, { method: "POST" });
export const trashEmail = (uid: string): Promise<unknown> => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/trash`, { method: "POST" });
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
export const markAllEmailsAsRead = (uids: string[]): Promise<unknown> => apiFetch("/api/briefing/email/mark-all-read", { method: "POST", body: JSON.stringify({ uids }) });
export const settleArrivalGrace = (): Promise<unknown> => apiFetch("/api/briefing/email/arrival-grace/settle", { method: "POST" });
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
function unwrapDeadlineMutationResult(result: unknown): unknown {
  const deadline = isRecord(result) ? result.deadline : undefined;
  return deadline ?? result;
}

export const getCalendarDeadlines = (): Promise<unknown> => apiFetch("/api/calendar/deadlines");
export const getCalendarDeadlinesRange = (start: string, end: string): Promise<unknown> =>
  apiFetch(`/api/calendar/deadlines/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
export const createDeadline = (data: unknown): Promise<unknown> =>
  apiFetch("/api/calendar/deadlines", { method: "POST", body: JSON.stringify(data) })
    .then(unwrapDeadlineMutationResult);
export const updateDeadline = (id: ApiId, data: unknown): Promise<unknown> =>
  apiFetch(`/api/calendar/deadlines/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) })
    .then(unwrapDeadlineMutationResult);
export const deleteDeadline = (id: ApiId): Promise<unknown> =>
  apiFetch(`/api/calendar/deadlines/${encodeURIComponent(id)}`, { method: "DELETE" });
export const completeDeadlineOccurrence = (id: ApiId, occurrenceDate: string): Promise<unknown> =>
  apiFetch(
    `/api/calendar/deadlines/${encodeURIComponent(id)}/completed-occurrences/${encodeURIComponent(occurrenceDate)}`,
    { method: "POST" },
  );
export const getCalendarBillsRange = (start: string, end: string): Promise<unknown> =>
  apiFetch(`/api/calendar/bills/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
export const getCalendarSearch = ({ scope, q, limit, signal }: CalendarSearchOptions = {}): Promise<unknown> => {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (q) params.set("q", q);
  if (limit) params.set("limit", String(limit));
  return apiFetch(`/api/calendar/search?${params.toString()}`, { signal });
};
// Calendar range fetch — used by useCalendarRange hook
export const getCalendarRange = (start: string, end: string, { signal }: SignalOptions = {}): Promise<unknown> =>
  apiFetch(`/api/calendar/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { signal });
export const getCalendarSources = (): Promise<unknown> => apiFetch("/api/calendar/calendars");
export const getCalendarPlaceSuggestions = (query: string, sessionToken?: string): Promise<unknown> =>
  apiFetch(`/api/calendar/places/suggest?q=${encodeURIComponent(query)}${sessionToken ? `&sessionToken=${encodeURIComponent(sessionToken)}` : ""}`);
export const getCalendarPlaceDetails = (placeId: string, sessionToken?: string): Promise<unknown> =>
  apiFetch(`/api/calendar/places/${encodeURIComponent(placeId)}${sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ""}`);
// Client-side deadline for calendar write mutations so a stalled request always
// settles (see apiFetch). 60s deliberately clears the server's own worst case —
// a 30s Google budget + 10s token refresh, and up to 4 chained Google calls on
// recurring "following" flows — so a slow-but-succeeding server write is not
// aborted into an inverse ghost. Reads/SSE intentionally opt out.
const CALENDAR_MUTATION_TIMEOUT_MS = 60_000;
export const createCalendarEvent = (data: unknown): Promise<unknown> =>
  apiFetch("/api/calendar/events", { method: "POST", body: JSON.stringify(data), timeoutMs: CALENDAR_MUTATION_TIMEOUT_MS });
export const createCalendarEventsBatch = (items: unknown[]): Promise<unknown> =>
  apiFetch("/api/calendar/events/batch", { method: "POST", body: JSON.stringify({ items }), timeoutMs: CALENDAR_MUTATION_TIMEOUT_MS });
export const updateCalendarEvent = (eventId: ApiId, data: unknown): Promise<unknown> =>
  apiFetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: JSON.stringify(data), timeoutMs: CALENDAR_MUTATION_TIMEOUT_MS });
export const deleteCalendarEvent = (eventId: ApiId, data: unknown): Promise<unknown> =>
  apiFetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, { method: "DELETE", body: JSON.stringify(data), timeoutMs: CALENDAR_MUTATION_TIMEOUT_MS });

// Todoist
export const getTodoistProjects = (): Promise<unknown> => apiFetch("/api/briefing/todoist/projects");
export const getTodoistLabels = (): Promise<unknown> => apiFetch("/api/briefing/todoist/labels");
export const createTodoistTask = (data: unknown): Promise<unknown> => apiFetch("/api/briefing/todoist/tasks", { method: "POST", body: JSON.stringify(data) });
export const updateTodoistTask = (id: ApiId, data: unknown): Promise<unknown> => apiFetch(`/api/briefing/todoist/tasks/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(data) });
export const deleteTodoistTask = (id: ApiId): Promise<unknown> => apiFetch(`/api/briefing/todoist/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });

// Actual Budget
export const sendToActualBudget = (bill: unknown): Promise<unknown> => apiFetch("/api/briefing/actual/send", { method: "POST", body: JSON.stringify(bill) });
export const extractBillFromEmail = ({ subject, from, body }: { subject: unknown; from: unknown; body: unknown }): Promise<unknown> => apiFetch("/api/briefing/bills/extract", { method: "POST", body: JSON.stringify({ subject, from, body }) });
export const resolveBillPaySeed = (payload: unknown): Promise<unknown> => apiFetch("/api/briefing/bills/resolve", { method: "POST", body: JSON.stringify(payload || {}) });
export const resolveBillPayMappingSample = (payload: unknown): Promise<unknown> => apiFetch("/api/briefing/bills/resolve-sample", { method: "POST", body: JSON.stringify(payload || {}) });
export const markBillPaid = (id: ApiId): Promise<unknown> => apiFetch(`/api/briefing/actual/bills/${encodeURIComponent(id)}/mark-paid`, { method: "POST" });
export const getActualAccounts = (): Promise<unknown> => apiFetch("/api/briefing/actual/accounts");
export const getActualPayees = (): Promise<unknown> => apiFetch("/api/briefing/actual/payees");
export const getActualCategories = (): Promise<unknown> => apiFetch("/api/briefing/actual/categories");
export const getActualMetadata = (): Promise<unknown> => apiFetch("/api/briefing/actual/metadata");
export const testActualBudget = (overrides: unknown): Promise<unknown> => apiFetch("/api/briefing/actual/test", { method: "POST", body: JSON.stringify(overrides || {}) });
export const getActualCacheStatus = (): Promise<unknown> => apiFetch("/api/briefing/actual/cache/status");
export const hydrateActualBudgetCache = (): Promise<unknown> => apiFetch("/api/briefing/actual/cache/hydrate", { method: "POST" });

// Accounts & Settings
export const getAccounts = (): Promise<unknown> => apiFetch("/api/ea/accounts");
export const getGmailAuthUrl = (): Promise<unknown> => apiFetch("/api/ea/accounts/gmail/auth");
export const addICloudAccount = (email: string, password: string): Promise<unknown> => apiFetch("/api/ea/accounts/icloud", { method: "POST", body: JSON.stringify({ email, password }) });
export const updateAccount = (id: ApiId, data: unknown): Promise<unknown> => apiFetch(`/api/ea/accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
export const removeAccount = (id: ApiId): Promise<unknown> => apiFetch(`/api/ea/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderAccounts = (order: unknown[]): Promise<unknown> => apiFetch("/api/ea/accounts/reorder", { method: "PATCH", body: JSON.stringify({ order }) });
export const getSettings = (): Promise<unknown> => apiFetch("/api/ea/settings");
export const updateSettings = (data: unknown): Promise<unknown> => apiFetch("/api/ea/settings", { method: "PUT", body: JSON.stringify(data) });
export const testDiscordReminderWebhook = (): Promise<unknown> => apiFetch("/api/ea/settings/discord-reminder-test", { method: "POST" });
export const listReminders = ({ sourceType, sourceItemId, sourceOccurrenceId }: ReminderListOptions = {}): Promise<unknown> => {
  const params = new URLSearchParams();
  if (sourceType) params.set("sourceType", sourceType);
  if (sourceItemId) params.set("sourceItemId", sourceItemId);
  if (sourceOccurrenceId) params.set("sourceOccurrenceId", sourceOccurrenceId);
  return apiFetch(`/api/ea/reminders?${params.toString()}`);
};
export const createReminder = (data: unknown): Promise<unknown> => apiFetch("/api/ea/reminders", { method: "POST", body: JSON.stringify(data) });
export const deleteReminder = (id: ApiId): Promise<unknown> => apiFetch(`/api/ea/reminders/${encodeURIComponent(id)}`, { method: "DELETE" });
export const geocodeLocation = (q: string): Promise<unknown> => apiFetch(`/api/ea/geocode?q=${encodeURIComponent(q)}`);
export const skipSchedule = (index: number, skip = true): Promise<unknown> => apiFetch("/api/ea/schedules/skip", { method: "POST", body: JSON.stringify({ index, skip }) });
export const getModels = (): Promise<unknown> => apiFetch("/api/ea/models");
export const getBillExtractModels = (): Promise<unknown> => apiFetch("/api/ea/bill-extract-models");

export const searchEmails = (query: string, limit?: string | number, { signal }: SignalOptions = {}): Promise<unknown> => {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set("limit", String(limit));
  return apiFetch(`/api/briefing/email-search?${params}`, { signal });
};

// Alfred — streaming run + conversation reset. Not apiFetch: the response is
// an SSE stream, not JSON.
export async function runAlfredStream({ message, conversationId, model, signal, onEvent }: AlfredStreamOptions): Promise<void> {
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
      ...(model ? { model } : {}),
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
  await readSseStream(res.body as ReadableStream<Uint8Array>, onEvent);
}

export const deleteAlfredConversation = (id: ApiId): Promise<unknown> => (
  apiFetch(`/api/alfred/conversations/${encodeURIComponent(id)}`, { method: "DELETE" })
);

// Important Senders
export const getImportantSenders = (): Promise<unknown> => apiFetch("/api/ea/important-senders");
export const updateImportantSenders = (senders: unknown[]): Promise<unknown> => apiFetch("/api/ea/important-senders", { method: "PUT", body: JSON.stringify({ senders }) });

// Notes
export const getNotes = (): Promise<unknown> => apiFetch("/api/notes");
export const createNote = (content: string): Promise<unknown> => apiFetch("/api/notes", { method: "POST", body: JSON.stringify({ content }) });
export const updateNote = (id: ApiId, content: string): Promise<unknown> => apiFetch(`/api/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ content }) });
export const deleteNote = (id: ApiId): Promise<unknown> => apiFetch(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderNotes = (noteIds: ApiId[]): Promise<unknown> => apiFetch("/api/notes/reorder", { method: "PATCH", body: JSON.stringify({ noteIds }) });
export const archiveNote = (id: ApiId, archived: boolean): Promise<unknown> =>
  apiFetch(`/api/notes/${encodeURIComponent(id)}/archive`, { method: "PATCH", body: JSON.stringify({ archived }) });

// News
export const getNews = (): Promise<unknown> => apiFetch("/api/news");
export const getNewsCatalog = (): Promise<unknown> => apiFetch("/api/news/catalog");
export const markNewsSeen = (at: string): Promise<unknown> =>
  apiFetch("/api/news/seen", { method: "POST", body: JSON.stringify({ at }) });
export const refreshNews = (): Promise<unknown> => apiFetch("/api/news/refresh", { method: "POST" });
export const createNewsTopic = (name: string): Promise<unknown> =>
  apiFetch("/api/news/topics", { method: "POST", body: JSON.stringify({ name }) });
export const renameNewsTopic = (id: ApiId, name: string): Promise<unknown> =>
  apiFetch(`/api/news/topics/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
export const updateNewsTopicMutedTerms = (id: ApiId, mutedTerms: string[]): Promise<unknown> =>
  apiFetch(`/api/news/topics/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ mutedTerms }) });
export const reorderNewsTopics = (ids: ApiId[]): Promise<unknown> =>
  apiFetch("/api/news/topics/reorder", { method: "POST", body: JSON.stringify({ ids }) });
export const deleteNewsTopic = (id: ApiId): Promise<unknown> =>
  apiFetch(`/api/news/topics/${encodeURIComponent(id)}`, { method: "DELETE" });
export const importNewsStarterTopics = (names: string[]): Promise<unknown> =>
  apiFetch("/api/news/topics/import-starter", { method: "POST", body: JSON.stringify({ names }) });
export const previewNewsSource = (url: string): Promise<unknown> =>
  apiFetch("/api/news/sources/preview", { method: "POST", body: JSON.stringify({ url }) });
export const createNewsSource = (data: unknown): Promise<unknown> =>
  apiFetch("/api/news/sources", { method: "POST", body: JSON.stringify(data) });
export const updateNewsSource = (id: ApiId, data: unknown): Promise<unknown> =>
  apiFetch(`/api/news/sources/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteNewsSource = (id: ApiId): Promise<unknown> =>
  apiFetch(`/api/news/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
