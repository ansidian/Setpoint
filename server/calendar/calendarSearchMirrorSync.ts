import db from "../db/connection.ts";
import {
  fetchCalendarMirrorEvents,
  listCalendarsForAccount,
} from "./calendar.ts";
import {
  iso,
  mirrorOccurrenceStatement,
  purgeExpiredTombstonesStatement,
  upsertStateStatement,
  stateSuccessStatement,
  tombstoneCalendarStatement,
  tombstoneRecurringFamilyStatement,
  tombstoneUnlistedCalendarStatements,
} from "./calendarSearchMirrorStatements.ts";
import { addMonthsIso } from "./calendar-range-model.ts";
import type { Client, Row } from "@libsql/client";
import type {
  GoogleCalendarSource,
  NormalizedCalendarEvent,
} from "../../shared/types/calendar.ts";
import type { StoredCalendarAccount } from "./calendar-google-client.ts";
import type { MirrorEvent } from "./calendarSearchMirrorStatements.ts";

export { addMonthsIso };

const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";
const MIRROR_HISTORY_MONTHS = 12;
const MIRROR_FUTURE_MONTHS = 18;
// Cancelled rows exist only so search readers skip deleted events; if one is
// purged early, the next sync that re-delivers the cancellation simply
// recreates it, so a short retention is safe and keeps the table bounded.
const TOMBSTONE_RETENTION_DAYS = 30;

type MirrorDbClient = Pick<Client, "execute" | "batch">;

interface MirrorWindow {
  start: string;
  end: string;
}

interface MirrorStateRow {
  sync_token?: string | null;
}

interface MirrorSyncResponse {
  events: MirrorEvent[];
  nextSyncToken?: string | null;
  syncToken?: string | null;
  fullSync?: boolean;
}

interface MirrorSyncClientInput {
  account: StoredCalendarAccount;
  calendar: GoogleCalendarSource;
  window: MirrorWindow;
  syncToken: string | null;
  mode?: "full" | "incremental";
}

type MirrorSyncClient = (input: MirrorSyncClientInput) => Promise<MirrorSyncResponse>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function pacificDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_CALENDAR_TZ,
  }).format(now);
}

export function calendarSearchMirrorWindow({ now = new Date() }: { now?: Date } = {}): MirrorWindow {
  const today = pacificDate(now);
  return {
    start: addMonthsIso(today, -MIRROR_HISTORY_MONTHS),
    end: addMonthsIso(today, MIRROR_FUTURE_MONTHS),
  };
}

function enabledCalendarAccounts(accounts: StoredCalendarAccount[] = []) {
  return accounts.filter((account) => account?.type === "gmail" && account.calendar_enabled);
}

async function loadState(
  userId: string,
  accountId: string,
  calendarId: string,
  dbClient: MirrorDbClient,
): Promise<MirrorStateRow | null> {
  const result = await dbClient.execute({
    sql: `SELECT * FROM ea_calendar_search_mirror_state
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
    args: [userId, accountId, calendarId],
  });
  return result.rows[0] as MirrorStateRow | undefined || null;
}

async function markSyncing(
  userId: string,
  accountId: string,
  calendarId: string,
  dbClient: MirrorDbClient,
  timestamp: string,
) {
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

async function markSyncFailed(
  userId: string,
  accountId: string,
  calendarId: string,
  dbClient: MirrorDbClient,
  timestamp: string,
  err: unknown,
) {
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
      errorMessage(err || "Calendar Search Mirror sync failed").slice(0, 500),
      timestamp,
      timestamp,
      userId,
      accountId,
      calendarId,
    ],
  });
}

function shouldTombstoneRecurringFamily(event: MirrorEvent) {
  const status = event?.status || (event?.is_deleted ? "cancelled" : "confirmed");
  return status === "cancelled" && !!event?.id && !event?.originalStartTime;
}

async function tombstoneUnlistedCalendars(
  userId: string,
  account: StoredCalendarAccount,
  calendars: GoogleCalendarSource[],
  dbClient: MirrorDbClient,
  timestamp: string,
) {
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

function isInvalidSyncTokenError(err: unknown) {
  const error = err as { code?: string; message?: string; status?: number };
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return error?.status === 410 || text.includes("sync_token_invalid") || text.includes("sync token");
}

function isRecurringSeriesMutation(event: MirrorEvent) {
  if (!event) return false;
  if (event.recurringKind === "series") return true;
  if (event.recurrence) return true;
  return !!(
    event.recurringEventId
    && event.recurringEventId === event.id
    && !event.originalStartTime
  );
}

function incrementalResponseNeedsFullSyncRepair(response: MirrorSyncResponse) {
  return (response?.events || []).some(isRecurringSeriesMutation);
}

async function defaultSyncClient({
  account,
  calendar,
  window,
  syncToken,
}: MirrorSyncClientInput): Promise<MirrorSyncResponse> {
  return fetchCalendarMirrorEvents(account, calendar, { window, syncToken });
}

async function syncCalendar(
  userId: string,
  account: StoredCalendarAccount,
  calendar: GoogleCalendarSource,
  {
    dbClient,
    syncClient,
    timestamp,
    window,
    forceFull,
  }: {
    dbClient: MirrorDbClient;
    syncClient: MirrorSyncClient;
    timestamp: string;
    window: MirrorWindow;
    forceFull: boolean;
  },
) {
  const state = await loadState(userId, account.id, calendar.id, dbClient);
  const canIncrement = !forceFull && state?.sync_token;
  await markSyncing(userId, account.id, calendar.id, dbClient, timestamp);

  let mode: "incremental" | "full" = canIncrement ? "incremental" : "full";
  let response: MirrorSyncResponse;
  try {
    response = await syncClient({
      account,
      calendar,
      window,
      syncToken: canIncrement ? String(state.sync_token) : null,
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
    sourceColor: event.sourceColor || calendar.backgroundColor || account.color || undefined,
  }, timestamp)));
  statements.push(stateSuccessStatement(userId, account, calendar, response, timestamp, isFullSync));
  await dbClient.batch(statements);
  return { fullSync: isFullSync, occurrences: events.filter((event) => event.status !== "cancelled" && !event.is_deleted).length };
}

export async function syncCalendarSearchMirror(
  userId: string,
  accounts: StoredCalendarAccount[],
  {
    dbClient = db,
    listCalendars = listCalendarsForAccount,
    syncClient = defaultSyncClient,
    now = new Date(),
    forceFull = false,
  }: {
    dbClient?: MirrorDbClient;
    listCalendars?: (account: StoredCalendarAccount) => Promise<GoogleCalendarSource[]>;
    syncClient?: MirrorSyncClient;
    now?: Date;
    forceFull?: boolean;
  } = {},
) {
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
