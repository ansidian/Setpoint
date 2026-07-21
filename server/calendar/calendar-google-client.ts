import db from "../db/connection.ts";
import { decrypt, encrypt } from "../platform/encryption.ts";
import { accountCredentialContext } from "../platform/credential-encryption-context.ts";
import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import { isInvalidGrantError, markAccountNeedsReauth, clearAccountNeedsReauth } from "../platform/provider-reauth.ts";
import type {
  CalendarAccount,
  GoogleCalendarSource,
  GoogleEventResource,
} from "../../shared/types/calendar.ts";
import { googleOAuthCredentialManager } from "../google-oauth-credentials.ts";

export interface StoredCalendarAccount extends CalendarAccount {
  credentials_encrypted?: string | null;
  needs_reauth?: boolean | number;
}

interface CalendarCredentials {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string[];
}

export interface AuthorizedCalendarAccount {
  account: StoredCalendarAccount;
  accessToken: string;
  credentials: CalendarCredentials;
  hasWriteScope: boolean;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface GoogleErrorDetails extends Record<string, unknown> {
  googleStatus: number;
  googleReason: string | null;
  googleMessage: string;
  rawGoogleError: string;
}

interface GoogleErrorEnvelope {
  error?: { errors?: Array<{ reason?: string }>; status?: string; message?: string; code?: number };
}

interface RawCalendarListEntry {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
}

interface CalendarListResponse {
  items?: RawCalendarListEntry[];
  nextPageToken?: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_FULL_SCOPE = "https://www.googleapis.com/auth/calendar";

const TOKEN_REFRESH_TIMEOUT_MS = 10_000;
const CALENDAR_API_TIMEOUT_MS = 30_000;

// Google's OAuth token responses normally carry expires_in (seconds), but a
// malformed/partial response can omit it. Defaulting to this TTL keeps
// expires_at finite so the refresh guard stays deterministic instead of
// computing NaN (NaN < anything is false, which would silently wedge refresh).
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

// Compute an absolute expiry (ms epoch) from a token response's expires_in,
// falling back to DEFAULT_TOKEN_TTL_SECONDS when it is missing or non-finite.
function computeExpiresAt(expiresIn: number | undefined, now = Date.now()) {
  const ttl = typeof expiresIn === "number" && Number.isFinite(expiresIn)
    ? expiresIn
    : DEFAULT_TOKEN_TTL_SECONDS;
  return now + ttl * 1000;
}

export class CalendarServiceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CalendarServiceError";
    this.status = status;
    this.code = code;
    Object.assign(this, details);
  }
}

export function throwCalendarError(
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new CalendarServiceError(status, code, message, details);
}

function getStoredScopes(credentials: CalendarCredentials) {
  if (!Array.isArray(credentials?.scopes)) return [];
  return credentials.scopes.filter(Boolean);
}

function hasCalendarWriteScope(credentials: CalendarCredentials) {
  const scopes = getStoredScopes(credentials);
  return scopes.includes(CALENDAR_WRITE_SCOPE) || scopes.includes(CALENDAR_FULL_SCOPE);
}

async function getAccountCredentials(account: StoredCalendarAccount): Promise<CalendarCredentials> {
  if (!account?.credentials_encrypted) {
    throwCalendarError(400, "calendar_auth_missing", "Calendar credentials are missing for this account");
  }
  try {
    return JSON.parse(
      decrypt(account.credentials_encrypted, accountCredentialContext(account.id)),
    ) as CalendarCredentials;
  } catch {
    throwCalendarError(500, "calendar_auth_invalid", "Calendar credentials could not be read");
  }
}

async function persistCredentials(accountId: string, credentials: CalendarCredentials) {
  await db.execute({
    sql: `UPDATE ea_accounts
          SET credentials_encrypted = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [encrypt(JSON.stringify(credentials), accountCredentialContext(accountId)), accountId],
  });
}

export async function getAuthorizedAccount(account: StoredCalendarAccount): Promise<AuthorizedCalendarAccount> {
  const credentials = await getAccountCredentials(account);

  if (typeof credentials.expires_at !== "number"
    || !Number.isFinite(credentials.expires_at)
    || credentials.expires_at < Date.now() + 5 * 60 * 1000) {
    const applicationCredentials = await googleOAuthCredentialManager.resolveActive();
    const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: applicationCredentials.clientId,
        client_secret: applicationCredentials.clientSecret,
        refresh_token: credentials.refresh_token!,
        grant_type: "refresh_token",
      }),
    }, { timeoutMs: TOKEN_REFRESH_TIMEOUT_MS });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (isInvalidGrantError(text)) {
        try {
          await markAccountNeedsReauth(account.id);
        } catch (markErr) {
          console.error("[Calendar] Failed to mark needs_reauth:", errorMessage(markErr));
        }
      }
      throwCalendarError(401, "calendar_token_refresh_failed", `Calendar token refresh failed: ${text || res.status}`);
    }

    const data = await res.json() as GoogleTokenResponse;
    credentials.access_token = data.access_token;
    credentials.expires_at = computeExpiresAt(data.expires_in);
    if (data.refresh_token) credentials.refresh_token = data.refresh_token;
    if (data.scope) credentials.scopes = data.scope.split(" ").filter(Boolean);

    await persistCredentials(account.id, credentials);

    if (account.needs_reauth) {
      try {
        await clearAccountNeedsReauth(account.id);
      } catch (clearErr) {
        console.error("[Calendar] Failed to clear needs_reauth:", errorMessage(clearErr));
      }
    }
  }

  return {
    account,
    accessToken: credentials.access_token,
    credentials,
    hasWriteScope: hasCalendarWriteScope(credentials),
  };
}

export async function googleCalendarFetch(
  auth: AuthorizedCalendarAccount,
  path: string,
  {
    method = "GET",
    query,
    body,
    headers = {},
  }: {
    method?: string;
    query?: Record<string, string | number | boolean | null | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const url = new URL(path, "https://www.googleapis.com/calendar/v3/");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetchWithTimeout(url, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, { timeoutMs: CALENDAR_API_TIMEOUT_MS });

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

async function readGoogleErrorDetails(res: Response): Promise<GoogleErrorDetails> {
  const rawGoogleError = await res.text().catch(() => "");
  let parsed: GoogleErrorEnvelope | null = null;
  if (rawGoogleError) {
    try {
      parsed = JSON.parse(rawGoogleError) as GoogleErrorEnvelope;
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

function googleCalendarUserMessage(details: Partial<GoogleErrorDetails> = {}) {
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

export function isGoogleEventNotFoundError(err: unknown) {
  const error = err as CalendarServiceError & Partial<GoogleErrorDetails>;
  return error?.code === "calendar_google_error"
    && (Number(error.googleStatus) === 404 || String(error.googleReason || "").toLowerCase() === "notfound");
}

export function isGoogleEventAlreadyExistsError(err: unknown) {
  const error = err as CalendarServiceError & Partial<GoogleErrorDetails>;
  return error?.code === "calendar_google_error"
    && (Number(error.googleStatus) === 409 || String(error.googleMessage || "").toLowerCase().includes("already exists"));
}

export function ifMatchHeaders(etag: string | null | undefined): Record<string, string> {
  return etag ? { "If-Match": etag } : {};
}

export async function getRawEvent(
  account: StoredCalendarAccount,
  calendarId: string,
  eventId: string,
  { auth: providedAuth = null }: { auth?: AuthorizedCalendarAccount | null } = {},
): Promise<{ auth: AuthorizedCalendarAccount; event: GoogleEventResource }> {
  // Callers that already resolved an authorized account (e.g. a recurring-event
  // mutation that just fetched the selected instance) can pass it to skip a
  // redundant credential decrypt + possible token refresh.
  const auth = providedAuth || await getAuthorizedAccount(account);
  const res = await googleCalendarFetch(auth, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  const event = await res.json() as GoogleEventResource;
  return { auth, event };
}

export function buildSyntheticPrimaryCalendar(account: StoredCalendarAccount, writable: boolean) {
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

function calendarListEntrySelected(raw: RawCalendarListEntry) {
  return raw?.selected !== false && raw?.hidden !== true && raw?.deleted !== true;
}

function normalizeCalendarEntry(
  account: StoredCalendarAccount,
  raw: RawCalendarListEntry,
  hasWriteScope: boolean,
): GoogleCalendarSource {
  const accessRole = raw.accessRole || "reader";
  const writable = hasWriteScope && (accessRole === "owner" || accessRole === "writer");
  return {
    id: raw.id || "primary",
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
// calendar-mutations). Single-user (EA_USER_ID) app, so a process-global Map
// is sufficient.
const CALENDAR_LIST_CACHE_TTL_MS = 120_000;
const calendarListCache = new Map<string, {
  value: GoogleCalendarSource[];
  expiresAt: number;
  credentialsKey: string;
}>();

export function invalidateCalendarListCache(accountId?: string | null) {
  if (accountId == null) {
    calendarListCache.clear();
    return;
  }
  calendarListCache.delete(accountId);
}

export async function listCalendarsForAccount(account: StoredCalendarAccount): Promise<GoogleCalendarSource[]> {
  const cacheKey = account?.id ?? null;
  const credentialsKey = account?.credentials_encrypted ?? "";
  if (cacheKey != null) {
    const cached = calendarListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.credentialsKey === credentialsKey) {
      return cached.value;
    }
  }

  const auth = await getAuthorizedAccount(account);
  const rawCalendars: RawCalendarListEntry[] = [];
  let pageToken: string | null = null;

  do {
    const res = await googleCalendarFetch(auth, "users/me/calendarList", {
      query: { pageToken, maxResults: 250, showHidden: false },
    }).catch((err: unknown) => {
      const error = err as CalendarServiceError;
      if (error.code === "calendar_google_forbidden" || error.code === "calendar_google_error") {
        return null;
      }
      throw err;
    });

    if (!res) break;
    const data = await res.json() as CalendarListResponse;
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
