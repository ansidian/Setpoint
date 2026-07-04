import db from "../db/connection.js";
import {
  fetchCalendarMirrorEvents,
  listCalendarsForAccount,
} from "./calendar.js";
import {
  iso,
  mirrorOccurrenceStatement,
  purgeExpiredTombstonesStatement,
  upsertStateStatement,
  stateSuccessStatement,
  tombstoneCalendarStatement,
  tombstoneRecurringFamilyStatement,
  tombstoneUnlistedCalendarStatements,
} from "./calendarSearchMirrorStatements.js";

const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";
const MIRROR_HISTORY_MONTHS = 12;
const MIRROR_FUTURE_MONTHS = 18;
// Cancelled rows exist only so search readers skip deleted events; if one is
// purged early, the next sync that re-delivers the cancellation simply
// recreates it, so a short retention is safe and keeps the table bounded.
const TOMBSTONE_RETENTION_DAYS = 30;

// Clamps day-of-month to the target month's last day so 29th-31st no longer
// overflow into the next month (which would shift the mirror/search window by up
// to 3 days). Exported as the single source of truth shared with
// server/routes/calendar.js.
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

function shouldTombstoneRecurringFamily(event) {
  const status = event?.status || (event?.is_deleted ? "cancelled" : "confirmed");
  return status === "cancelled" && !!event?.id && !event?.originalStartTime;
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
    const accountCalendars = calendars || [];
    calendarCount += accountCalendars.length;
    // Sync this account's calendars concurrently: each one's dominant cost is an
    // independent paginated Google round-trip, and every write is keyed on a
    // distinct (user_id, account_id, calendar_id) row so they never conflict.
    const results = await Promise.all(accountCalendars.map(async (calendar) => {
      await dbClient.execute(upsertStateStatement(userId, account, calendar, window, timestamp));
      return syncCalendar(userId, account, calendar, {
        dbClient,
        syncClient,
        timestamp,
        window,
        forceFull,
      });
    }));
    for (const result of results) {
      didFullSync = didFullSync || result.fullSync;
      occurrenceCount += result.occurrences;
    }
  }

  const purgeCutoff = iso(new Date(now.getTime() - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  await dbClient.execute(purgeExpiredTombstonesStatement(userId, purgeCutoff));

  return {
    status: "current",
    synced: true,
    fullSync: didFullSync,
    calendars: calendarCount,
    occurrences: occurrenceCount,
    window,
  };
}
