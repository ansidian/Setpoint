import db from "../db/connection.js";
import { decrypt, encrypt } from "../platform/encryption.js";

export const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_FULL_SCOPE = "https://www.googleapis.com/auth/calendar";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export class CalendarServiceError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "CalendarServiceError";
    this.status = status;
    this.code = code;
    Object.assign(this, details);
  }
}

export function throwCalendarError(status, code, message, details) {
  throw new CalendarServiceError(status, code, message, details);
}

function getStoredScopes(credentials) {
  if (!Array.isArray(credentials?.scopes)) return [];
  return credentials.scopes.filter(Boolean);
}

function hasCalendarWriteScope(credentials) {
  const scopes = getStoredScopes(credentials);
  return scopes.includes(CALENDAR_WRITE_SCOPE) || scopes.includes(CALENDAR_FULL_SCOPE);
}

async function getAccountCredentials(account) {
  if (!account?.credentials_encrypted) {
    throwCalendarError(400, "calendar_auth_missing", "Calendar credentials are missing for this account");
  }
  try {
    return JSON.parse(decrypt(account.credentials_encrypted));
  } catch {
    throwCalendarError(500, "calendar_auth_invalid", "Calendar credentials could not be read");
  }
}

async function persistCredentials(accountId, credentials) {
  await db.execute({
    sql: `UPDATE ea_accounts
          SET credentials_encrypted = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [encrypt(JSON.stringify(credentials)), accountId],
  });
}

export async function getAuthorizedAccount(account) {
  const credentials = await getAccountCredentials(account);

  if (credentials.expires_at < Date.now() + 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwCalendarError(401, "calendar_token_refresh_failed", `Calendar token refresh failed: ${text || res.status}`);
    }

    const data = await res.json();
    credentials.access_token = data.access_token;
    credentials.expires_at = Date.now() + data.expires_in * 1000;
    if (data.refresh_token) credentials.refresh_token = data.refresh_token;
    if (data.scope) credentials.scopes = data.scope.split(" ").filter(Boolean);

    await persistCredentials(account.id, credentials);
  }

  return {
    account,
    accessToken: credentials.access_token,
    credentials,
    hasWriteScope: hasCalendarWriteScope(credentials),
  };
}

export async function googleCalendarFetch(auth, path, { method = "GET", query, body, headers = {} } = {}) {
  const url = new URL(path, "https://www.googleapis.com/calendar/v3/");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 412) {
    throwCalendarError(409, "calendar_event_conflict", "This event changed elsewhere. Reload and try again.");
  }
  if (res.status === 410) {
    throwCalendarError(410, "calendar_sync_token_invalid", "Google Calendar sync token expired.");
  }
  if (res.status === 401 || res.status === 403) {
    const details = await readGoogleErrorDetails(res);
    throwCalendarError(
      403,
      "calendar_google_forbidden",
      "Google Calendar rejected this request. Reconnect Gmail if it keeps happening.",
      details,
    );
  }
  if (!res.ok) {
    const details = await readGoogleErrorDetails(res);
    throwCalendarError(502, "calendar_google_error", googleCalendarUserMessage(details), details);
  }

  return res;
}

async function readGoogleErrorDetails(res) {
  const rawGoogleError = await res.text().catch(() => "");
  let parsed = null;
  if (rawGoogleError) {
    try {
      parsed = JSON.parse(rawGoogleError);
    } catch {
      parsed = null;
    }
  }

  const googleError = parsed?.error || null;
  const googleReason = googleError?.errors?.[0]?.reason || googleError?.status || null;
  const googleMessage = typeof googleError?.message === "string"
    ? googleError.message
    : rawGoogleError || `Google Calendar request failed: ${res.status}`;

  return {
    googleStatus: Number(googleError?.code) || res.status,
    googleReason,
    googleMessage,
    rawGoogleError,
  };
}

function googleCalendarUserMessage(details = {}) {
  const googleStatus = Number(details.googleStatus) || 0;
  const googleReason = String(details.googleReason || "").toLowerCase();
  const googleMessage = String(details.googleMessage || "");
  const normalizedMessage = googleMessage.toLowerCase();

  if (googleStatus === 404 || googleReason === "notfound") {
    return "Google Calendar could not find this event. Refresh the calendar and try again.";
  }
  if (googleStatus === 409 || normalizedMessage.includes("already exists")) {
    return "Google Calendar already has this event in the target calendar. Refreshing will show the latest copy.";
  }
  return "Google Calendar could not save this event. Refresh the calendar and try again.";
}

export function isGoogleEventNotFoundError(err) {
  return err?.code === "calendar_google_error"
    && (Number(err.googleStatus) === 404 || String(err.googleReason || "").toLowerCase() === "notfound");
}

export function isGoogleEventAlreadyExistsError(err) {
  return err?.code === "calendar_google_error"
    && (Number(err.googleStatus) === 409 || String(err.googleMessage || "").toLowerCase().includes("already exists"));
}

export function ifMatchHeaders(etag) {
  return etag ? { "If-Match": etag } : {};
}

export async function getRawEvent(account, calendarId, eventId, { auth: providedAuth = null } = {}) {
  // Callers that already resolved an authorized account (e.g. a recurring-event
  // mutation that just fetched the selected instance) can pass it to skip a
  // redundant credential decrypt + possible token refresh.
  const auth = providedAuth || await getAuthorizedAccount(account);
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  const event = await res.json();
  return { auth, event };
}

export function buildSyntheticPrimaryCalendar(account, writable) {
  return {
    id: "primary",
    summary: "Primary",
    backgroundColor: account.color || "#4285f4",
    accessRole: writable ? "writer" : "reader",
    primary: true,
    writable,
    syntheticCalendarListFallback: true,
  };
}

function calendarListEntrySelected(raw) {
  return raw?.selected !== false && raw?.hidden !== true && raw?.deleted !== true;
}

function normalizeCalendarEntry(account, raw, hasWriteScope) {
  const accessRole = raw.accessRole || "reader";
  const writable = hasWriteScope && (accessRole === "owner" || accessRole === "writer");
  return {
    id: raw.id,
    summary: raw.summary || raw.summaryOverride || raw.id || "Untitled calendar",
    backgroundColor: raw.backgroundColor || account.color || "#4285f4",
    accessRole,
    primary: !!raw.primary,
    writable,
  };
}

// Short-TTL per-account memo for the Google calendarList. The list is read on
// every /range open, every /calendars call, the dashboard provider refresh, the
// mirror-sync tick, and every event mutation; it almost never changes within a
// session. Keyed by account.id and discriminated by the stored credentials blob,
// because the per-calendar `writable` flag is derived from the credential's
// scopes — a re-auth that adds calendar write scope changes credentials_encrypted
// and must NOT serve a stale writable=false list. credentials_encrypted is stable
// between (hourly) token refreshes, so the hot-path benefit holds. Invalidated on
// event mutations (see invalidateCalendarListCache callers in
// calendar-mutations.js). Single-user (EA_USER_ID) app, so a process-global Map
// is sufficient.
const CALENDAR_LIST_CACHE_TTL_MS = 120_000;
const calendarListCache = new Map();

export function invalidateCalendarListCache(accountId) {
  if (accountId == null) {
    calendarListCache.clear();
    return;
  }
  calendarListCache.delete(accountId);
}

export async function listCalendarsForAccount(account) {
  const cacheKey = account?.id ?? null;
  const credentialsKey = account?.credentials_encrypted ?? "";
  if (cacheKey != null) {
    const cached = calendarListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.credentialsKey === credentialsKey) {
      return cached.value;
    }
  }

  const auth = await getAuthorizedAccount(account);
  let rawCalendars = [];
  let pageToken = null;

  do {
    const res = await googleCalendarFetch(auth, "users/me/calendarList", {
      query: { pageToken, maxResults: 250, showHidden: false },
    }).catch((err) => {
      if (err.code === "calendar_google_forbidden" || err.code === "calendar_google_error") {
        return null;
      }
      throw err;
    });

    if (!res) break;
    const data = await res.json();
    rawCalendars.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  // Don't cache the synthetic fallback: it is the symptom of a transient
  // forbidden/error response, and caching it would mask recovery for 120s.
  if (rawCalendars.length === 0) {
    return [buildSyntheticPrimaryCalendar(account, auth.hasWriteScope)];
  }

  const calendars = rawCalendars
    .filter(calendarListEntrySelected)
    .map((entry) => normalizeCalendarEntry(account, entry, auth.hasWriteScope))
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      if (a.writable !== b.writable) return a.writable ? -1 : 1;
      return a.summary.localeCompare(b.summary);
    });

  if (cacheKey != null) {
    calendarListCache.set(cacheKey, {
      value: calendars,
      expiresAt: Date.now() + CALENDAR_LIST_CACHE_TTL_MS,
      credentialsKey,
    });
  }

  return calendars;
}
