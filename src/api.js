async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "EADashboard",
      ...options.headers,
    },
  });

  if (res.status === 401) {
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
export const checkAuth = () => apiFetch("/api/auth/check");
export async function login(password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "EADashboard" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `API error: ${res.status}`);
  }
  return res.json();
}
export const logout = () => apiFetch("/api/auth/logout", { method: "POST" });
export const listApiTokens = () => apiFetch("/api/auth/api-tokens");
export const createApiToken = (label, scopes) => apiFetch("/api/auth/api-tokens", { method: "POST", body: JSON.stringify({ label, scopes }) });
export const revokeApiToken = (id) => apiFetch(`/api/auth/api-tokens/${id}`, { method: "DELETE" });

// Briefings
export const getLatestBriefing = (scenarioOverride) => {
  const params = new URLSearchParams(window.location.search);
  const mock = params.get("mock");
  if (scenarioOverride) return apiFetch(`/api/briefing/latest?mock=1&scenario=${scenarioOverride}`);
  const scenario = params.get("scenario");
  const qs = mock ? `?mock=1${scenario ? `&scenario=${scenario}` : ""}` : "";
  return apiFetch(`/api/briefing/latest${qs}`);
};
export const getDevScenarios = () => apiFetch("/api/briefing/scenarios");
export const triggerGeneration = () => apiFetch("/api/briefing/generate", { method: "POST" });
export const quickRefresh = () => apiFetch("/api/briefing/refresh", { method: "POST" });
export const pollStatus = (id) => apiFetch(`/api/briefing/status/${id}`);
export const checkInProgress = () => apiFetch("/api/briefing/in-progress");
export const getBriefingHistory = () => apiFetch("/api/briefing/history");
export const getBriefingById = (id) => apiFetch(`/api/briefing/${id}`);
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
export const pinEmail = (emailId, snapshot = null) =>
  apiFetch(`/api/briefing/pin/${encodeURIComponent(emailId)}`, {
    method: "POST",
    body: JSON.stringify({ snapshot }),
  });
export const unpinEmail = (emailId) => apiFetch(`/api/briefing/pin/${encodeURIComponent(emailId)}`, { method: "DELETE" });
export const snoozeEmail = (uid, untilTs, snapshot = null) =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/snooze`, {
    method: "POST",
    body: JSON.stringify({ until_ts: untilTs, snapshot }),
  });
export const unsnoozeEmail = (uid) =>
  apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/snooze`, { method: "DELETE" });
export const completeTask = (taskId) => apiFetch(`/api/briefing/complete-task/${encodeURIComponent(taskId)}`, { method: "POST" });
export const updateTaskStatus = (taskId, status) => apiFetch(`/api/briefing/task-status/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const dismissTombstone = (todoistId) =>
  apiFetch(`/api/briefing/tombstone/${todoistId}`, { method: "DELETE" });
export const markEmailAsRead = (uid) => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/mark-read`, { method: "POST" });
export const markEmailAsUnread = (uid) => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/mark-unread`, { method: "POST" });
export const trashEmail = (uid) => apiFetch(`/api/briefing/email/${encodeURIComponent(uid)}/trash`, { method: "POST" });
export const markAllEmailsAsRead = (uids) => apiFetch("/api/briefing/email/mark-all-read", { method: "POST", body: JSON.stringify({ uids }) });
export const deleteBriefing = (id) => apiFetch(`/api/briefing/${id}`, { method: "DELETE" });

// Calendar
export const getCalendarDeadlines = () => apiFetch("/api/calendar/deadlines");
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
export const markBillPaid = (id) => apiFetch(`/api/briefing/actual/bills/${encodeURIComponent(id)}/mark-paid`, { method: "POST" });
export const getActualAccounts = () => apiFetch("/api/briefing/actual/accounts");
export const getActualPayees = () => apiFetch("/api/briefing/actual/payees");
export const getActualCategories = () => apiFetch("/api/briefing/actual/categories");
export const getActualMetadata = () => apiFetch("/api/briefing/actual/metadata");
export const testActualBudget = (overrides) => apiFetch("/api/briefing/actual/test", { method: "POST", body: JSON.stringify(overrides || {}) });

// Accounts & Settings
export const getAccounts = () => apiFetch("/api/ea/accounts");
export const getGmailAuthUrl = () => apiFetch("/api/ea/accounts/gmail/auth");
export const addICloudAccount = (email, password) => apiFetch("/api/ea/accounts/icloud", { method: "POST", body: JSON.stringify({ email, password }) });
export const updateAccount = (id, data) => apiFetch(`/api/ea/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const removeAccount = (id) => apiFetch(`/api/ea/accounts/${id}`, { method: "DELETE" });
export const reorderAccounts = (order) => apiFetch("/api/ea/accounts/reorder", { method: "PATCH", body: JSON.stringify({ order }) });
export const getSettings = () => apiFetch("/api/ea/settings");
export const updateSettings = (data) => apiFetch("/api/ea/settings", { method: "PUT", body: JSON.stringify(data) });
export const geocodeLocation = (q) => apiFetch(`/api/ea/geocode?q=${encodeURIComponent(q)}`);
export const skipSchedule = (index, skip = true) => apiFetch("/api/ea/schedules/skip", { method: "POST", body: JSON.stringify({ index, skip }) });
export const getModels = () => apiFetch("/api/ea/models");
export const getBillExtractModels = () => apiFetch("/api/ea/bill-extract-models");
export const suspendService = () => apiFetch("/api/ea/suspend", { method: "POST" });

// Search
export const searchBriefings = (query, options = {}) => {
  const params = new URLSearchParams({ q: query });
  if (options.types) params.set("types", options.types);
  if (options.limit) params.set("limit", options.limit);
  return apiFetch(`/api/search?${params}`);
};
export const analyzeSearchResults = (query, results) => apiFetch("/api/search/analyze", { method: "POST", body: JSON.stringify({ query, results }) });
export const searchEmails = (query, limit) => {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set("limit", limit);
  return apiFetch(`/api/briefing/email-search?${params}`);
};

// Live Data
export const getLiveData = () => apiFetch("/api/live/all");

// Important Senders
export const getImportantSenders = () => apiFetch("/api/ea/important-senders");
export const updateImportantSenders = (senders) => apiFetch("/api/ea/important-senders", { method: "PUT", body: JSON.stringify({ senders }) });

// Notes
export const getNotes = () => apiFetch("/api/notes");
export const createNote = (content) => apiFetch("/api/notes", { method: "POST", body: JSON.stringify({ content }) });
export const updateNote = (id, content) => apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify({ content }) });
export const deleteNote = (id) => apiFetch(`/api/notes/${id}`, { method: "DELETE" });
export const reorderNotes = (noteIds) => apiFetch("/api/notes/reorder", { method: "PATCH", body: JSON.stringify({ noteIds }) });
