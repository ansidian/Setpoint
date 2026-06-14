import { isDemoMode } from "./demo/config.js";
import { handleDemoApiRequest } from "./demo/apiAdapter.js";

async function apiFetch(path, options = {}) {
  if (isDemoMode()) {
    return handleDemoApiRequest(path, options);
  }
  const { redirectOnAuthFailure = true, ...fetchOptions } = options;

  const res = await fetch(path, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Setpoint",
      ...fetchOptions.headers,
    },
  });

  if (res.status === 401 && redirectOnAuthFailure) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new Error(body?.message || `API error: ${res.status}`);
    error.code = body?.code || null;
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Auth
export const checkAuth = () => (
  isDemoMode() ? Promise.resolve({ authenticated: true, demo: true }) : apiFetch("/api/auth/check")
);
export async function login(password) {
  if (isDemoMode()) return { authenticated: true, demo: true };

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "Setpoint" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `API error: ${res.status}`);
  }
  return res.json();
}
export const getPasskeyAuthenticationOptions = () => (
  apiFetch("/api/auth/passkey/authentication/options", {
    method: "POST",
    redirectOnAuthFailure: false,
  })
);
export const verifyPasskeyAuthentication = (credential) => (
  apiFetch("/api/auth/passkey/authentication/verify", {
    method: "POST",
    redirectOnAuthFailure: false,
    body: JSON.stringify(credential),
  })
);
export const cancelPasskeyAuthentication = () => (
  apiFetch("/api/auth/passkey/authentication/cancel", {
    method: "POST",
    redirectOnAuthFailure: false,
  })
);
export const logout = () => apiFetch("/api/auth/logout", { method: "POST" });
export const listPasskeys = () => apiFetch("/api/auth/passkeys");
export const getPasskeyRegistrationOptions = (label) => (
  apiFetch("/api/auth/passkeys/registration/options", {
    method: "POST",
    redirectOnAuthFailure: false,
    body: JSON.stringify({ label }),
  })
);
export const verifyPasskeyRegistration = (credential) => (
  apiFetch("/api/auth/passkeys/registration/verify", {
    method: "POST",
    redirectOnAuthFailure: false,
    body: JSON.stringify(credential),
  })
);
export const deletePasskeyCredential = (credentialId) => (
  apiFetch(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
    redirectOnAuthFailure: false,
  })
);
export const listApiTokens = () => apiFetch("/api/auth/api-tokens");
export const createApiToken = (label, scopes) => apiFetch("/api/auth/api-tokens", { method: "POST", body: JSON.stringify({ label, scopes }) });
export const revokeApiToken = (id) => apiFetch(`/api/auth/api-tokens/${id}`, { method: "DELETE" });

// Current snapshot and operational dashboard data
export const getActiveSnapshot = () => apiFetch("/api/briefing/snapshot/active");
export const syncActiveSnapshot = () => apiFetch("/api/briefing/snapshot/sync", { method: "POST" });
export const getSnapshotHistory = () => apiFetch("/api/briefing/snapshot/history");
export const getSnapshotById = (id) => apiFetch(`/api/briefing/snapshot/${encodeURIComponent(id)}`);
export const moveSnapshotItemLane = (itemId, lane) =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/lane`, {
    method: "PATCH",
    body: JSON.stringify({ lane }),
  });
export const dismissSnapshotItemForToday = (itemId) =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/dismiss`, { method: "POST" });
export const restoreSnapshotItemForToday = (itemId) =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/restore`, { method: "POST" });
export const markSnapshotItemHandled = (itemId) =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/handled`, { method: "POST" });
export const reopenSnapshotItem = (itemId) =>
  apiFetch(`/api/briefing/snapshot/items/${encodeURIComponent(itemId)}/reopen`, { method: "POST" });

// Current Dashboard
export const getCurrentDashboard = () => apiFetch("/api/dashboard/current");
export const getDashboardHealth = () => apiFetch("/api/dashboard/health");
export const requestCurrentDashboardRefresh = () => apiFetch("/api/dashboard/current/refresh", { method: "POST" });
export const syncCurrentDashboard = () => apiFetch("/api/dashboard/current/sync", { method: "POST" });
export const getTriageCacheStats = (options = {}) => (
  apiFetch(`/api/ea/triage/cache-stats${options.semantic ? "?semantic=1" : ""}`)
);
// 5-minute in-memory TTL cache for email bodies. Bodies don't mutate
// server-side once delivered; the cache eliminates the loading flicker on
// re-selection and dedupes concurrent fetches for the same uid.
const EMAIL_BODY_TTL_MS = 5 * 60 * 1000;
const emailBodyCache = new Map(); // uid -> { promise, expiresAt, value }
export const getEmailBody = (uid) => {
  const now = Date.now();
  const hit = emailBodyCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.value ? Promise.resolve(hit.value) : hit.promise;
  const promise = apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}`)
    .then((value) => {
      emailBodyCache.set(uid, { promise, value, expiresAt: Date.now() + EMAIL_BODY_TTL_MS });
      return value;
    })
    .catch((err) => {
      // Don't poison the cache on failure — let the next call retry.
      emailBodyCache.delete(uid);
      throw err;
    });
  emailBodyCache.set(uid, { promise, value: null, expiresAt: now + EMAIL_BODY_TTL_MS });
  return promise;
};
export const peekEmailBody = (uid) => {
  const hit = emailBodyCache.get(uid);
  return hit && hit.value && hit.expiresAt > Date.now() ? hit.value : null;
};
export const dismissEmail = (emailId) => apiFetch(`/api/briefing/dismiss/${encodeURIComponent(emailId)}`, { method: "POST" });
export const snoozeEmail = (uid, untilTs, snapshot = null) =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/snooze`, {
    method: "POST",
    body: JSON.stringify({ until_ts: untilTs, snapshot }),
  });
export const unsnoozeEmail = (uid) =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/snooze`, { method: "DELETE" });
export const completeTask = (taskId) => apiFetch(`/api/briefing/complete-task/${encodeURIComponent(taskId)}`, { method: "POST" });
export const dismissTombstone = (todoistId) =>
  apiFetch(`/api/briefing/tombstone/${todoistId}`, { method: "DELETE" });
export const markEmailAsRead = (uid) => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/mark-read`, { method: "POST" });
export const markEmailAsUnread = (uid) => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/mark-unread`, { method: "POST" });
export const trashEmail = (uid) => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/trash`, { method: "POST" });
export const trashEmailOnExit = (uid) => {
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
export const markAllEmailsAsRead = (uids) => apiFetch("/api/briefing/email/mark-all-read", { method: "POST", body: JSON.stringify({ uids }) });
export const settleArrivalGrace = () => apiFetch("/api/briefing/email/arrival-grace/settle", { method: "POST" });
export const settleArrivalGraceOnExit = () => {
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
function unwrapDeadlineMutationResult(result) {
  return result?.deadline ?? result;
}

export const getCalendarDeadlines = () => apiFetch("/api/calendar/deadlines");
export const getCalendarDeadlinesRange = (start, end) =>
  apiFetch(`/api/calendar/deadlines/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
export const createDeadline = (data) =>
  apiFetch("/api/calendar/deadlines", { method: "POST", body: JSON.stringify(data) })
    .then(unwrapDeadlineMutationResult);
export const updateDeadline = (id, data) =>
  apiFetch(`/api/calendar/deadlines/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) })
    .then(unwrapDeadlineMutationResult);
export const deleteDeadline = (id) =>
  apiFetch(`/api/calendar/deadlines/${encodeURIComponent(id)}`, { method: "DELETE" });
export const completeDeadlineOccurrence = (id, occurrenceDate) =>
  apiFetch(
    `/api/calendar/deadlines/${encodeURIComponent(id)}/completed-occurrences/${encodeURIComponent(occurrenceDate)}`,
    { method: "POST" },
  );
export const getCalendarBillsRange = (start, end) =>
  apiFetch(`/api/calendar/bills/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
export const getCalendarSearch = ({ scope, q, limit } = {}) => {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (q) params.set("q", q);
  if (limit) params.set("limit", String(limit));
  return apiFetch(`/api/calendar/search?${params.toString()}`);
};
// Calendar range fetch — used by useCalendarRange hook
export const getCalendarRange = (start, end) =>
  apiFetch(`/api/calendar/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
export const getCalendarSources = () => apiFetch("/api/calendar/calendars");
export const getCalendarPlaceSuggestions = (query, sessionToken) =>
  apiFetch(`/api/calendar/places/suggest?q=${encodeURIComponent(query)}${sessionToken ? `&sessionToken=${encodeURIComponent(sessionToken)}` : ""}`);
export const getCalendarPlaceDetails = (placeId, sessionToken) =>
  apiFetch(`/api/calendar/places/${encodeURIComponent(placeId)}${sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ""}`);
export const createCalendarEvent = (data) =>
  apiFetch("/api/calendar/events", { method: "POST", body: JSON.stringify(data) });
export const createCalendarEventsBatch = (items) =>
  apiFetch("/api/calendar/events/batch", { method: "POST", body: JSON.stringify({ items }) });
export const updateCalendarEvent = (eventId, data) =>
  apiFetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteCalendarEvent = (eventId, data) =>
  apiFetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, { method: "DELETE", body: JSON.stringify(data) });

// Todoist
export const getTodoistProjects = () => apiFetch("/api/briefing/todoist/projects");
export const getTodoistLabels = () => apiFetch("/api/briefing/todoist/labels");
export const createTodoistTask = (data) => apiFetch("/api/briefing/todoist/tasks", { method: "POST", body: JSON.stringify(data) });
export const updateTodoistTask = (id, data) => apiFetch(`/api/briefing/todoist/tasks/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(data) });
export const deleteTodoistTask = (id) => apiFetch(`/api/briefing/todoist/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });

// Actual Budget
export const sendToActualBudget = (bill) => apiFetch("/api/briefing/actual/send", { method: "POST", body: JSON.stringify(bill) });
export const extractBillFromEmail = ({ subject, from, body }) => apiFetch("/api/briefing/bills/extract", { method: "POST", body: JSON.stringify({ subject, from, body }) });
export const resolveBillPaySeed = (payload) => apiFetch("/api/briefing/bills/resolve", { method: "POST", body: JSON.stringify(payload || {}) });
export const resolveBillPayMappingSample = (payload) => apiFetch("/api/briefing/bills/resolve-sample", { method: "POST", body: JSON.stringify(payload || {}) });
export const markBillPaid = (id) => apiFetch(`/api/briefing/actual/bills/${encodeURIComponent(id)}/mark-paid`, { method: "POST" });
export const getActualAccounts = () => apiFetch("/api/briefing/actual/accounts");
export const getActualPayees = () => apiFetch("/api/briefing/actual/payees");
export const getActualCategories = () => apiFetch("/api/briefing/actual/categories");
export const getActualMetadata = () => apiFetch("/api/briefing/actual/metadata");
export const testActualBudget = (overrides) => apiFetch("/api/briefing/actual/test", { method: "POST", body: JSON.stringify(overrides || {}) });
export const getActualCacheStatus = () => apiFetch("/api/briefing/actual/cache/status");
export const hydrateActualBudgetCache = () => apiFetch("/api/briefing/actual/cache/hydrate", { method: "POST" });

// Accounts & Settings
export const getAccounts = () => apiFetch("/api/ea/accounts");
export const getGmailAuthUrl = () => apiFetch("/api/ea/accounts/gmail/auth");
export const addICloudAccount = (email, password) => apiFetch("/api/ea/accounts/icloud", { method: "POST", body: JSON.stringify({ email, password }) });
export const updateAccount = (id, data) => apiFetch(`/api/ea/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const removeAccount = (id) => apiFetch(`/api/ea/accounts/${id}`, { method: "DELETE" });
export const reorderAccounts = (order) => apiFetch("/api/ea/accounts/reorder", { method: "PATCH", body: JSON.stringify({ order }) });
export const getSettings = () => apiFetch("/api/ea/settings");
export const updateSettings = (data) => apiFetch("/api/ea/settings", { method: "PUT", body: JSON.stringify(data) });
export const testDiscordReminderWebhook = () => apiFetch("/api/ea/settings/discord-reminder-test", { method: "POST" });
export const listReminders = ({ sourceType, sourceItemId, sourceOccurrenceId } = {}) => {
  const params = new URLSearchParams();
  if (sourceType) params.set("sourceType", sourceType);
  if (sourceItemId) params.set("sourceItemId", sourceItemId);
  if (sourceOccurrenceId) params.set("sourceOccurrenceId", sourceOccurrenceId);
  return apiFetch(`/api/ea/reminders?${params.toString()}`);
};
export const createReminder = (data) => apiFetch("/api/ea/reminders", { method: "POST", body: JSON.stringify(data) });
export const deleteReminder = (id) => apiFetch(`/api/ea/reminders/${encodeURIComponent(id)}`, { method: "DELETE" });
export const geocodeLocation = (q) => apiFetch(`/api/ea/geocode?q=${encodeURIComponent(q)}`);
export const skipSchedule = (index, skip = true) => apiFetch("/api/ea/schedules/skip", { method: "POST", body: JSON.stringify({ index, skip }) });
export const getModels = () => apiFetch("/api/ea/models");
export const getBillExtractModels = () => apiFetch("/api/ea/bill-extract-models");

export const searchEmails = (query, limit) => {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set("limit", limit);
  return apiFetch(`/api/briefing/email-search?${params}`);
};

export const askInboxAiSearch = (query, limit) => (
  apiFetch("/api/briefing/email-search/ask-ai", {
    method: "POST",
    body: JSON.stringify({
      q: query,
      ...(limit ? { limit } : {}),
    }),
  })
);

// Important Senders
export const getImportantSenders = () => apiFetch("/api/ea/important-senders");
export const updateImportantSenders = (senders) => apiFetch("/api/ea/important-senders", { method: "PUT", body: JSON.stringify({ senders }) });

// Notes
export const getNotes = () => apiFetch("/api/notes");
export const createNote = (content) => apiFetch("/api/notes", { method: "POST", body: JSON.stringify({ content }) });
export const updateNote = (id, content) => apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify({ content }) });
export const deleteNote = (id) => apiFetch(`/api/notes/${id}`, { method: "DELETE" });
export const reorderNotes = (noteIds) => apiFetch("/api/notes/reorder", { method: "PATCH", body: JSON.stringify({ noteIds }) });
