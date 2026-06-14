import db from "../db/connection.js";
import {
  fetchCalendarMirrorEvents,
  listCalendarsForAccount,
} from "./calendar.js";
import { loadUserConfig } from "../platform/config-service.js";

const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";
const MIRROR_HISTORY_MONTHS = 12;
const MIRROR_FUTURE_MONTHS = 18;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const DEGRADED_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SYNC_DEBOUNCE_MS = 1000;
export const CALENDAR_SEARCH_MIRROR_SYNC_BACKSTOP_MS = 15 * 60 * 1000;

const pendingSyncs = new Map();
const activeSyncs = new Map();
let mirrorSyncWorkerTimer = null;

function iso(now) {
  return now.toISOString();
}

function boolInt(value) {
  return value ? 1 : 0;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// MERGE-NOTE[P3-41] (P3 worktree): escape LIKE metacharacters so a query containing
// `_` or `%` matches literally instead of acting as a wildcard. Used with `ESCAPE '\'`
// in listCalendarSearchMirrorOccurrences. Shares this file with a P2 fix on another
// worktree. On conflict: keep BOTH unless they touch these same lines. Remove after merge.
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

// MERGE-NOTE[P3-40] (P3 worktree): addMonthsIso now clamps day-of-month to the target
// month's last day so 29th-31st no longer overflow into the next month (shifting the
// mirror/search window by up to 3 days). Exported as the single source of truth shared with
// server/routes/calendar.js. Shares this file with a P2 fix on another worktree. On conflict:
// keep BOTH unless they touch these same lines. Remove this note after merge.
export function addMonthsIso(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const targetYear = year;
  const targetMonth = month - 1 + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  const date = new Date(Date.UTC(targetYear, targetMonth, clampedDay));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

function pacificDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_CALENDAR_TZ,
  }).format(now);
}

function dateMs(isoDate, end = false) {
  const suffix = end ? "T23:59:59.999Z" : "T00:00:00.000Z";
  return Date.parse(`${isoDate}${suffix}`);
}

export function calendarSearchMirrorWindow({ now = new Date() } = {}) {
  const today = pacificDate(now);
  return {
    start: addMonthsIso(today, -MIRROR_HISTORY_MONTHS),
    end: addMonthsIso(today, MIRROR_FUTURE_MONTHS),
  };
}

function enabledCalendarAccounts(accounts = []) {
  return accounts.filter((account) => account?.type === "gmail" && account.calendar_enabled);
}

function occurrenceKey(event) {
  return String(event?.originalStartTime || event?.startMs || event?.id || "");
}

function searchableText(event) {
  return normalizeText([
    event.title,
    event.location,
    event.description,
  ].filter(Boolean).join(" "));
}

function mirrorOccurrenceStatement(userId, event, timestamp) {
  const status = event.status || (event.is_deleted ? "cancelled" : "confirmed");
  const deletedAt = status === "cancelled" || event.is_deleted ? timestamp : null;
  return {
    sql: `INSERT INTO ea_calendar_search_occurrences
            (user_id, account_id, calendar_id, event_id, original_start_key,
             title, location, description, source_label, account_label, account_email,
             start_ms, end_ms, all_day, time_label, duration_label, source_color,
             event_color, color_id, html_link, open_url, recurring_event_id,
             recurring_kind, is_recurring, status, searchable_text, raw_json,
             synced_at, deleted_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, account_id, calendar_id, event_id, original_start_key) DO UPDATE SET
            title = excluded.title,
            location = excluded.location,
            description = excluded.description,
            source_label = excluded.source_label,
            account_label = excluded.account_label,
            account_email = excluded.account_email,
            start_ms = excluded.start_ms,
            end_ms = excluded.end_ms,
            all_day = excluded.all_day,
            time_label = excluded.time_label,
            duration_label = excluded.duration_label,
            source_color = excluded.source_color,
            event_color = excluded.event_color,
            color_id = excluded.color_id,
            html_link = excluded.html_link,
            open_url = excluded.open_url,
            recurring_event_id = excluded.recurring_event_id,
            recurring_kind = excluded.recurring_kind,
            is_recurring = excluded.is_recurring,
            status = excluded.status,
            searchable_text = excluded.searchable_text,
            raw_json = excluded.raw_json,
            synced_at = excluded.synced_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      String(event.accountId || ""),
      String(event.calendarId || ""),
      String(event.id || ""),
      occurrenceKey(event),
      event.title || "",
      event.location || "",
      event.description || "",
      event.source || event.calendarName || "Google Calendar",
      event.accountLabel || null,
      event.accountEmail || null,
      Number(event.startMs || 0),
      Number(event.endMs || event.startMs || 0),
      boolInt(event.allDay),
      event.time || null,
      event.duration || null,
      event.sourceColor || null,
      event.color || event.sourceColor || null,
      event.colorId || null,
      event.htmlLink || null,
      event.openUrl || event.htmlLink || null,
      event.recurringEventId || null,
      event.recurringKind || null,
      boolInt(event.isRecurring || event.recurringEventId || event.originalStartTime),
      status,
      searchableText(event),
      JSON.stringify(event),
      timestamp,
      deletedAt,
      timestamp,
    ],
  };
}

function upsertStateStatement(userId, account, calendar, window, timestamp) {
  return {
    sql: `INSERT INTO ea_calendar_search_mirror_state
            (user_id, account_id, calendar_id, account_label, account_email,
             calendar_label, source_color, window_start, window_end, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?)
          ON CONFLICT(user_id, account_id, calendar_id) DO UPDATE SET
            account_label = excluded.account_label,
            account_email = excluded.account_email,
            calendar_label = excluded.calendar_label,
            source_color = excluded.source_color,
            window_start = excluded.window_start,
            window_end = excluded.window_end,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      account.id,
      calendar.id,
      account.label || null,
      account.email || null,
      calendar.summary || calendar.id,
      calendar.backgroundColor || account.color || null,
      window.start,
      window.end,
      timestamp,
    ],
  };
}

async function loadState(userId, accountId, calendarId, dbClient) {
  const result = await dbClient.execute({
    sql: `SELECT * FROM ea_calendar_search_mirror_state
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
    args: [userId, accountId, calendarId],
  });
  return result.rows[0] || null;
}

async function markSyncing(userId, accountId, calendarId, dbClient, timestamp) {
  await dbClient.execute({
    sql: `UPDATE ea_calendar_search_mirror_state
          SET status = 'syncing',
              sync_started_at = ?,
              last_error = NULL,
              updated_at = ?
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
    args: [timestamp, timestamp, userId, accountId, calendarId],
  });
}

async function markSyncFailed(userId, accountId, calendarId, dbClient, timestamp, err) {
  await dbClient.execute({
    sql: `UPDATE ea_calendar_search_mirror_state
          SET status = 'idle',
              sync_started_at = NULL,
              last_error = ?,
              last_check_failed_at = ?,
              failed_check_count = COALESCE(failed_check_count, 0) + 1,
              updated_at = ?
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
    args: [
      String(err?.message || err || "Calendar Search Mirror sync failed").slice(0, 500),
      timestamp,
      timestamp,
      userId,
      accountId,
      calendarId,
    ],
  });
}

function stateSuccessStatement(userId, account, calendar, response, timestamp, isFullSync) {
  return {
    // dirty_since / sync_requested_at are only cleared if they predate this sync's
    // start (`timestamp`). A write that marks the row dirty DURING the fetch sets a
    // newer value, which must survive so a follow-up sync is still scheduled
    // (otherwise the mirror serves stale occurrences — a lost-update race).
    sql: `UPDATE ea_calendar_search_mirror_state
          SET sync_token = ?,
              status = 'idle',
              last_sync_at = ?,
              last_success_at = ?,
              last_full_sync_at = COALESCE(?, last_full_sync_at),
              last_incremental_sync_at = COALESCE(?, last_incremental_sync_at),
              last_error = NULL,
              sync_started_at = NULL,
              sync_requested_at = CASE WHEN sync_requested_at IS NOT NULL AND sync_requested_at > ? THEN sync_requested_at ELSE NULL END,
              sync_request_reason = CASE WHEN sync_requested_at IS NOT NULL AND sync_requested_at > ? THEN sync_request_reason ELSE NULL END,
              dirty_since = CASE WHEN dirty_since IS NOT NULL AND dirty_since > ? THEN dirty_since ELSE NULL END,
              dirty_reason = CASE WHEN dirty_since IS NOT NULL AND dirty_since > ? THEN dirty_reason ELSE NULL END,
              last_check_failed_at = NULL,
              failed_check_count = 0,
              updated_at = ?
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
    args: [
      response.nextSyncToken || response.syncToken || null,
      timestamp,
      timestamp,
      isFullSync ? timestamp : null,
      isFullSync ? null : timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      userId,
      account.id,
      calendar.id,
    ],
  };
}

function tombstoneCalendarStatement(userId, account, calendar, timestamp) {
  return {
    sql: `UPDATE ea_calendar_search_occurrences
          SET status = 'cancelled',
              deleted_at = ?,
              updated_at = ?
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
    args: [timestamp, timestamp, userId, account.id, calendar.id],
  };
}

function shouldTombstoneRecurringFamily(event) {
  const status = event?.status || (event?.is_deleted ? "cancelled" : "confirmed");
  return status === "cancelled" && !!event?.id && !event?.originalStartTime;
}

function tombstoneRecurringFamilyStatement(userId, account, calendar, event, timestamp) {
  const familyId = String(event.recurringEventId || event.id || "");
  return {
    sql: `UPDATE ea_calendar_search_occurrences
          SET status = 'cancelled',
              deleted_at = ?,
              updated_at = ?
          WHERE user_id = ?
            AND account_id = ?
            AND calendar_id = ?
            AND (event_id = ? OR recurring_event_id = ?)`,
    args: [timestamp, timestamp, userId, account.id, calendar.id, familyId, familyId],
  };
}

function tombstoneUnlistedCalendarStatements(userId, account, calendarId, timestamp) {
  return [
    {
      sql: `UPDATE ea_calendar_search_occurrences
            SET status = 'cancelled',
                deleted_at = ?,
                updated_at = ?
            WHERE user_id = ?
              AND account_id = ?
              AND calendar_id = ?
              AND status != 'cancelled'`,
      args: [timestamp, timestamp, userId, account.id, calendarId],
    },
    {
      sql: `DELETE FROM ea_calendar_search_mirror_state
            WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
      args: [userId, account.id, calendarId],
    },
  ];
}

async function tombstoneUnlistedCalendars(userId, account, calendars, dbClient, timestamp) {
  if (!userId || !account?.id || !Array.isArray(calendars)) return 0;
  if (calendars.some((calendar) => calendar?.syntheticCalendarListFallback)) return 0;
  const activeIds = new Set(
    calendars
      .map((calendar) => calendar?.id)
      .filter(Boolean)
      .map(String),
  );
  const existing = await dbClient.execute({
    sql: `SELECT calendar_id
          FROM ea_calendar_search_mirror_state
          WHERE user_id = ? AND account_id = ?`,
    args: [userId, account.id],
  });
  const staleCalendarIds = existing.rows
    .map((row) => String(row.calendar_id || ""))
    .filter((calendarId) => calendarId && !activeIds.has(calendarId));
  if (!staleCalendarIds.length) return 0;
  await dbClient.batch(
    staleCalendarIds.flatMap((calendarId) => (
      tombstoneUnlistedCalendarStatements(userId, account, calendarId, timestamp)
    )),
  );
  return staleCalendarIds.length;
}

function isInvalidSyncTokenError(err) {
  const text = `${err?.code || ""} ${err?.message || ""}`.toLowerCase();
  return err?.status === 410 || text.includes("sync_token_invalid") || text.includes("sync token");
}

function isRecurringSeriesMutation(event) {
  if (!event) return false;
  if (event.recurringKind === "series") return true;
  if (event.recurrence) return true;
  return !!(
    event.recurringEventId
    && event.recurringEventId === event.id
    && !event.originalStartTime
  );
}

function incrementalResponseNeedsFullSyncRepair(response) {
  return (response?.events || []).some(isRecurringSeriesMutation);
}

async function defaultSyncClient({ account, calendar, window, syncToken }) {
  return fetchCalendarMirrorEvents(account, calendar, { window, syncToken });
}

async function syncCalendar(userId, account, calendar, {
  dbClient,
  syncClient,
  timestamp,
  window,
  forceFull,
}) {
  const state = await loadState(userId, account.id, calendar.id, dbClient);
  const canIncrement = !forceFull && state?.sync_token;
  await markSyncing(userId, account.id, calendar.id, dbClient, timestamp);

  let mode = canIncrement ? "incremental" : "full";
  let response;
  try {
    response = await syncClient({
      account,
      calendar,
      window,
      syncToken: canIncrement ? state.sync_token : null,
      mode,
    });
  } catch (err) {
    if (canIncrement && isInvalidSyncTokenError(err)) {
      mode = "full";
      response = await syncClient({
        account,
        calendar,
        window,
        syncToken: null,
        mode,
      });
    } else {
      await markSyncFailed(userId, account.id, calendar.id, dbClient, timestamp, err);
      throw err;
    }
  }

  if (mode === "incremental" && incrementalResponseNeedsFullSyncRepair(response)) {
    mode = "full";
    try {
      response = await syncClient({
        account,
        calendar,
        window,
        syncToken: null,
        mode,
      });
    } catch (err) {
      await markSyncFailed(userId, account.id, calendar.id, dbClient, timestamp, err);
      throw err;
    }
  }

  const isFullSync = mode === "full" || !!response.fullSync;
  const events = response.events || [];
  const statements = [];
  if (isFullSync) statements.push(tombstoneCalendarStatement(userId, account, calendar, timestamp));
  statements.push(
    ...events
      .filter(shouldTombstoneRecurringFamily)
      .map((event) => tombstoneRecurringFamilyStatement(userId, account, calendar, event, timestamp)),
  );
  statements.push(...events.map((event) => mirrorOccurrenceStatement(userId, {
    ...event,
    accountId: event.accountId || account.id,
    accountLabel: event.accountLabel || account.label,
    accountEmail: event.accountEmail || account.email,
    calendarId: event.calendarId || calendar.id,
    calendarName: event.calendarName || calendar.summary,
    source: event.source || calendar.summary,
    sourceColor: event.sourceColor || calendar.backgroundColor || account.color,
  }, timestamp)));
  statements.push(stateSuccessStatement(userId, account, calendar, response, timestamp, isFullSync));
  await dbClient.batch(statements);
  return { fullSync: isFullSync, occurrences: events.filter((event) => event.status !== "cancelled" && !event.is_deleted).length };
}

export async function syncCalendarSearchMirror(userId, accounts, {
  dbClient = db,
  listCalendars = listCalendarsForAccount,
  syncClient = defaultSyncClient,
  now = new Date(),
  forceFull = false,
} = {}) {
  if (!userId) return { status: "unconfigured", synced: false, calendars: 0, occurrences: 0 };
  const timestamp = iso(now);
  const window = calendarSearchMirrorWindow({ now });
  let calendarCount = 0;
  let occurrenceCount = 0;
  let didFullSync = false;

  for (const account of enabledCalendarAccounts(accounts)) {
    const calendars = await listCalendars(account);
    await tombstoneUnlistedCalendars(userId, account, calendars, dbClient, timestamp);
    for (const calendar of calendars || []) {
      calendarCount += 1;
      await dbClient.execute(upsertStateStatement(userId, account, calendar, window, timestamp));
      const result = await syncCalendar(userId, account, calendar, {
        dbClient,
        syncClient,
        timestamp,
        window,
        forceFull,
      });
      didFullSync = didFullSync || result.fullSync;
      occurrenceCount += result.occurrences;
    }
  }

  return {
    status: "current",
    synced: true,
    fullSync: didFullSync,
    calendars: calendarCount,
    occurrences: occurrenceCount,
    window,
  };
}

function scheduleRequestedCalendarSearchMirrorSync(userId, {
  delayMs,
  syncFn,
  loadConfigFn,
  recordSyncRequestFn,
} = {}) {
  const pending = pendingSyncs.get(userId);
  if (!pending || pending.timer || activeSyncs.has(userId)) return;

  pending.timer = setTimeout(() => {
    const next = pendingSyncs.get(userId);
    if (next) next.timer = null;
    runRequestedCalendarSearchMirrorSync(userId, { syncFn, loadConfigFn, recordSyncRequestFn });
  }, delayMs);
  pending.timer.unref?.();
}

async function runRequestedCalendarSearchMirrorSync(userId, {
  syncFn = syncCalendarSearchMirror,
  loadConfigFn = loadUserConfig,
  recordSyncRequestFn = recordCalendarSearchMirrorSyncRequest,
} = {}) {
  const requested = pendingSyncs.get(userId);
  if (!requested || activeSyncs.has(userId)) return null;

  pendingSyncs.delete(userId);
  const active = Promise.resolve()
    .then(async () => {
      await recordSyncRequestFn(userId, {
        reason: requested.reason,
      });
      const { accounts } = await loadConfigFn(userId);
      return syncFn(userId, accounts, {
        forceFull: !!requested.forceFull,
      });
    })
    .catch((err) => {
      console.error("[Calendar] requested search mirror sync failed:", err.message);
      return null;
    })
    .finally(() => {
      activeSyncs.delete(userId);
      if (pendingSyncs.has(userId)) {
        scheduleRequestedCalendarSearchMirrorSync(userId, {
          delayMs: 0,
          syncFn,
          loadConfigFn,
          recordSyncRequestFn,
        });
      }
    });
  activeSyncs.set(userId, active);
  return active;
}

export function requestCalendarSearchMirrorSync(userId, {
  reason = "manual",
  debounceMs = DEFAULT_SYNC_DEBOUNCE_MS,
  forceFull = false,
  syncFn,
  loadConfigFn,
  recordSyncRequestFn,
} = {}) {
  if (!userId) return { queued: false };
  const existing = pendingSyncs.get(userId);
  if (existing) {
    existing.reason = reason;
    existing.forceFull = existing.forceFull || forceFull;
    return { queued: true, coalesced: true };
  }

  pendingSyncs.set(userId, {
    reason,
    forceFull,
    timer: null,
  });
  scheduleRequestedCalendarSearchMirrorSync(userId, {
    delayMs: debounceMs,
    syncFn,
    loadConfigFn,
    recordSyncRequestFn,
  });
  return { queued: true, coalesced: false };
}

async function requestStartupCalendarSearchMirrorSyncIfNeeded(userId, {
  getHealthFn = getCalendarSearchMirrorHealth,
  requestSyncFn = requestCalendarSearchMirrorSync,
} = {}) {
  if (!userId) return;
  const health = await getHealthFn(userId);
  if (health.state === "current" || health.state === "syncing") return;
  const hasSuccessfulSource = (health.sources || []).some((source) => source.lastSuccessAt);
  requestSyncFn(userId, {
    reason: "calendar-search-startup",
    debounceMs: 0,
    forceFull: !hasSuccessfulSource,
  });
}

export function startCalendarSearchMirrorSyncWorker({
  userId = process.env.EA_USER_ID,
  intervalMs = CALENDAR_SEARCH_MIRROR_SYNC_BACKSTOP_MS,
  getHealthFn = getCalendarSearchMirrorHealth,
  requestSyncFn = requestCalendarSearchMirrorSync,
} = {}) {
  if (!userId || mirrorSyncWorkerTimer) return { started: false };

  requestStartupCalendarSearchMirrorSyncIfNeeded(userId, { getHealthFn, requestSyncFn })
    .catch((err) => console.error("[Calendar] search mirror startup sync check failed:", err.message));

  mirrorSyncWorkerTimer = setInterval(() => {
    requestSyncFn(userId, {
      reason: "calendar-search-backstop",
    });
  }, intervalMs);
  mirrorSyncWorkerTimer.unref?.();
  console.log("[Calendar] Search mirror sync worker started (every 15 minutes)");
  return { started: true };
}

export function stopCalendarSearchMirrorSyncWorker() {
  if (mirrorSyncWorkerTimer) {
    clearInterval(mirrorSyncWorkerTimer);
    mirrorSyncWorkerTimer = null;
  }
  for (const pending of pendingSyncs.values()) {
    if (pending.timer) clearTimeout(pending.timer);
  }
  pendingSyncs.clear();
  activeSyncs.clear();
}

export async function recordCalendarSearchMirrorSyncRequest(userId, {
  dbClient = db,
  accountId = null,
  calendarId = null,
  reason = "calendar-search",
  now = new Date(),
} = {}) {
  if (!userId) return { recorded: false };
  const timestamp = iso(now);
  const filters = [];
  const args = [timestamp, reason, timestamp, userId];
  if (accountId) {
    filters.push("account_id = ?");
    args.push(accountId);
  }
  if (calendarId) {
    filters.push("calendar_id = ?");
    args.push(calendarId);
  }
  const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  await dbClient.execute({
    sql: `UPDATE ea_calendar_search_mirror_state
          SET sync_requested_at = ?,
              sync_request_reason = ?,
              updated_at = ?
          WHERE user_id = ?${where}`,
    args,
  });
  return { recorded: true, syncRequestedAt: timestamp, reason };
}

export async function markCalendarSearchMirrorDirty(userId, {
  dbClient = db,
  accountId,
  calendarId,
  reason = "calendar-write",
  now = new Date(),
} = {}) {
  if (!userId || !accountId || !calendarId) return { marked: false };
  const timestamp = iso(now);
  await dbClient.execute({
    sql: `UPDATE ea_calendar_search_mirror_state
          SET dirty_since = ?,
              dirty_reason = ?,
              sync_requested_at = ?,
              sync_request_reason = ?,
              updated_at = ?
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
    args: [timestamp, reason, timestamp, reason, timestamp, userId, accountId, calendarId],
  });
  return { marked: true, dirtySince: timestamp, reason };
}

export async function upsertCalendarSearchMirrorOccurrence(userId, event, {
  dbClient = db,
  now = new Date(),
  recordPendingSync = true,
} = {}) {
  if (!userId || !event?.accountId || !event?.calendarId || !event?.id) return { upserted: false };
  const timestamp = iso(now);
  await dbClient.execute(mirrorOccurrenceStatement(userId, event, timestamp));
  if (recordPendingSync) {
    await markCalendarSearchMirrorDirty(userId, {
      dbClient,
      accountId: event.accountId,
      calendarId: event.calendarId,
      reason: "calendar-write",
      now,
    });
  }
  return { upserted: true };
}

export async function deleteCalendarSearchMirrorOccurrence(userId, {
  dbClient = db,
  accountId,
  calendarId,
  eventId,
  originalStartTime = null,
  now = new Date(),
  recordPendingSync = true,
} = {}) {
  if (!userId || !accountId || !calendarId || !eventId) return { deleted: false };
  const timestamp = iso(now);
  const originalStartKey = originalStartTime ? " AND original_start_key = ?" : "";
  await dbClient.execute({
    sql: `UPDATE ea_calendar_search_occurrences
          SET status = 'cancelled',
              deleted_at = ?,
              updated_at = ?
          WHERE user_id = ? AND account_id = ? AND calendar_id = ? AND event_id = ?${originalStartKey}`,
    args: [
      timestamp,
      timestamp,
      userId,
      accountId,
      calendarId,
      eventId,
      ...(originalStartTime ? [originalStartTime] : []),
    ],
  });
  if (recordPendingSync) {
    await markCalendarSearchMirrorDirty(userId, {
      dbClient,
      accountId,
      calendarId,
      reason: "calendar-write",
      now,
    });
  }
  return { deleted: true };
}

function rowToOccurrence(row) {
  return {
    id: row.event_id,
    title: row.title || "(No title)",
    location: row.location || "",
    description: row.description || "",
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    time: row.time_label || "",
    duration: row.duration_label || "",
    source: row.source_label || "Google Calendar",
    sourceColor: row.source_color || "#4285f4",
    color: row.event_color || row.source_color || "#4285f4",
    colorId: row.color_id || null,
    accountId: row.account_id,
    accountLabel: row.account_label || null,
    accountEmail: row.account_email || null,
    calendarId: row.calendar_id,
    calendarName: row.source_label || null,
    allDay: !!row.all_day,
    originalStartTime: row.original_start_key || null,
    recurringEventId: row.recurring_event_id || null,
    recurringKind: row.recurring_kind || null,
    isRecurring: !!row.is_recurring,
    htmlLink: row.html_link || null,
    openUrl: row.open_url || row.html_link || null,
  };
}

export async function listCalendarSearchMirrorOccurrences(userId, {
  dbClient = db,
  start,
  end,
  query = null,
  limit = 500,
  centerDate = null,
} = {}) {
  const startMs = dateMs(start || "0001-01-01");
  const endMs = dateMs(end || "9999-12-31", true);
  const normalizedQuery = normalizeText(query);
  // MERGE-NOTE[P3-41] (P3 worktree): bind an escaped LIKE pattern with ESCAPE '\' so user
  // `_`/`%` are literal. Shares this file with a P2 fix on another worktree; keep BOTH on
  // conflict unless touching these same lines. Remove after merge.
  const likePattern = normalizedQuery ? `%${escapeLikePattern(normalizedQuery)}%` : null;
  const querySql = normalizedQuery ? " AND searchable_text LIKE ? ESCAPE '\\'" : "";
  const centerMs = centerDate ? dateMs(centerDate) + (12 * 60 * 60 * 1000) : null;
  const orderSql = Number.isFinite(centerMs)
    ? "ABS(start_ms - ?) ASC, start_ms ASC, title COLLATE NOCASE ASC"
    : "start_ms ASC, title COLLATE NOCASE ASC";
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_calendar_search_occurrences
          WHERE user_id = ?
            AND status != 'cancelled'
            AND start_ms >= ?
            AND start_ms <= ?${querySql}
          ORDER BY ${orderSql}
          LIMIT ?`,
    args: [
      userId,
      startMs,
      endMs,
      ...(likePattern ? [likePattern] : []),
      ...(Number.isFinite(centerMs) ? [centerMs] : []),
      limit,
    ],
  });
  return result.rows.map(rowToOccurrence);
}

function isAfter(left, right) {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
}

function ageMs(value, now) {
  if (!value) return null;
  return Math.max(0, now.getTime() - new Date(value).getTime());
}

function sourceHealth(row, now) {
  const lastSuccessAt = row.last_success_at || null;
  const successAgeMs = ageMs(lastSuccessAt, now);
  const pendingSync = isAfter(row.sync_requested_at, lastSuccessAt);
  const dirty = isAfter(row.dirty_since, lastSuccessAt);
  const failedAgeMs = ageMs(row.last_check_failed_at || lastSuccessAt, now);
  const failedCheckCount = Number(row.failed_check_count || 0);

  let state = "current";
  let severity = "none";
  if (row.status === "syncing") {
    state = "syncing";
    severity = "info";
  } else if (!lastSuccessAt) {
    state = "initializing";
    severity = "info";
  } else if (dirty || pendingSync) {
    state = "dirty";
    severity = "warning";
  } else if (failedCheckCount > 0 && failedAgeMs != null && failedAgeMs >= DEGRADED_AFTER_MS) {
    state = "degraded";
    severity = "warning";
  } else if (successAgeMs != null && successAgeMs >= STALE_AFTER_MS) {
    state = "stale";
    severity = "warning";
  }

  return {
    accountId: row.account_id,
    calendarId: row.calendar_id,
    accountLabel: row.account_label || null,
    accountEmail: row.account_email || null,
    calendarLabel: row.calendar_label || row.calendar_id,
    sourceColor: row.source_color || null,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    state,
    severity,
    lastSuccessAt,
    lastError: row.last_error || null,
    syncStartedAt: row.sync_started_at || null,
    syncRequestedAt: row.sync_requested_at || null,
    syncRequestReason: row.sync_request_reason || null,
    dirtySince: row.dirty_since || null,
    dirtyReason: row.dirty_reason || null,
    lastCheckFailedAt: row.last_check_failed_at || null,
    failedCheckCount,
    ageMs: successAgeMs,
  };
}

function aggregateHealth(sources) {
  if (!sources.length) return { state: "initializing", severity: "info" };
  if (sources.some((source) => source.state === "degraded")) return { state: "degraded", severity: "warning" };
  if (sources.some((source) => source.state === "dirty")) return { state: "dirty", severity: "warning" };
  if (sources.some((source) => source.state === "stale")) return { state: "stale", severity: "warning" };
  if (sources.some((source) => source.state === "initializing")) return { state: "initializing", severity: "info" };
  if (sources.some((source) => source.state === "syncing")) return { state: "syncing", severity: "info" };
  return { state: "current", severity: "none" };
}

export async function getCalendarSearchMirrorHealth(userId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_calendar_search_mirror_state
          WHERE user_id = ?
          ORDER BY account_label COLLATE NOCASE ASC, calendar_label COLLATE NOCASE ASC, calendar_id ASC`,
    args: [userId],
  });
  const sources = result.rows.map((row) => sourceHealth(row, now));
  const aggregate = aggregateHealth(sources);
  return {
    state: aggregate.state,
    configured: true,
    severity: aggregate.severity,
    sources,
  };
}
