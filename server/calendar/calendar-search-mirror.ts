import db from "../db/connection.ts";
import { loadUserConfig } from "../platform/config-service.ts";
import {
  iso,
  normalizeText,
  mirrorOccurrenceStatement,
} from "./calendarSearchMirrorStatements.ts";
import { computeCalendarSearchMirrorHealth } from "./calendarSearchMirrorHealthModel.ts";
import {
  syncCalendarSearchMirror,
  calendarSearchMirrorWindow,
  addMonthsIso,
} from "./calendarSearchMirrorSync.ts";
import type { Client, Row } from "@libsql/client";
import type {
  NormalizedCalendarEvent,
} from "../../shared/types/calendar.ts";
import type { StoredCalendarAccount } from "./calendar-google-client.ts";
import type { MirrorEvent } from "./calendarSearchMirrorStatements.ts";
import type { EventSearchInput as CalendarEventSearchInput } from "./calendar-search.ts";

// Re-export the sync-engine surface so the public module path stays unchanged.
export { syncCalendarSearchMirror, calendarSearchMirrorWindow, addMonthsIso };

const DEFAULT_SYNC_DEBOUNCE_MS = 1000;
export const CALENDAR_SEARCH_MIRROR_SYNC_BACKSTOP_MS = 15 * 60 * 1000;

type MirrorDbClient = Pick<Client, "execute">;
type MirrorSyncFn = (
  userId: string,
  accounts: StoredCalendarAccount[],
  options: { forceFull: boolean },
) => Promise<unknown>;
type LoadConfigFn = (userId: string) => Promise<{ accounts: unknown[] }>;
type RecordSyncRequestFn = (userId: string, options: { reason: string }) => Promise<unknown>;
type GetHealthFn = (userId: string) => Promise<{
  state: string;
  sources?: Array<{ lastSuccessAt?: string | null }>;
}>;
type EventSearchInput = CalendarEventSearchInput & Record<string, unknown>;

interface PendingSync {
  reason: string;
  forceFull: boolean;
  timer: NodeJS.Timeout | null;
}

interface RequestSyncOptions {
  reason?: string;
  debounceMs?: number;
  forceFull?: boolean;
  syncFn?: MirrorSyncFn;
  loadConfigFn?: LoadConfigFn;
  recordSyncRequestFn?: RecordSyncRequestFn;
}

const pendingSyncs = new Map<string, PendingSync>();
const activeSyncs = new Map<string, Promise<unknown | null>>();
let mirrorSyncWorkerTimer: NodeJS.Timeout | null = null;

// Escape LIKE metacharacters so a query containing `_` or `%` matches literally
// instead of acting as a wildcard. Used with `ESCAPE '\'` in
// listCalendarSearchMirrorOccurrences.
function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function dateMs(isoDate: string, end = false) {
  const suffix = end ? "T23:59:59.999Z" : "T00:00:00.000Z";
  return Date.parse(`${isoDate}${suffix}`);
}

function scheduleRequestedCalendarSearchMirrorSync(userId: string, {
  delayMs,
  syncFn,
  loadConfigFn,
  recordSyncRequestFn,
}: {
  delayMs?: number;
  syncFn?: MirrorSyncFn;
  loadConfigFn?: LoadConfigFn;
  recordSyncRequestFn?: RecordSyncRequestFn;
} = {}) {
  const pending = pendingSyncs.get(userId);
  if (!pending || pending.timer || activeSyncs.has(userId)) return;

  pending.timer = setTimeout(() => {
    const next = pendingSyncs.get(userId);
    if (next) next.timer = null;
    runRequestedCalendarSearchMirrorSync(userId, { syncFn, loadConfigFn, recordSyncRequestFn });
  }, delayMs ?? 0);
  pending.timer.unref?.();
}

async function runRequestedCalendarSearchMirrorSync(userId: string, {
  syncFn = syncCalendarSearchMirror,
  loadConfigFn = loadUserConfig,
  recordSyncRequestFn = recordCalendarSearchMirrorSyncRequest,
}: {
  syncFn?: MirrorSyncFn;
  loadConfigFn?: LoadConfigFn;
  recordSyncRequestFn?: RecordSyncRequestFn;
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
      return syncFn(userId, accounts as StoredCalendarAccount[], {
        forceFull: !!requested.forceFull,
      });
    })
    .catch((err: unknown) => {
      console.error("[Calendar] requested search mirror sync failed:", err instanceof Error ? err.message : String(err));
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

export function requestCalendarSearchMirrorSync(userId: string, {
  reason = "manual",
  debounceMs = DEFAULT_SYNC_DEBOUNCE_MS,
  forceFull = false,
  syncFn,
  loadConfigFn,
  recordSyncRequestFn,
}: RequestSyncOptions = {}) {
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

async function requestStartupCalendarSearchMirrorSyncIfNeeded(userId: string, {
  getHealthFn = getCalendarSearchMirrorHealth,
  requestSyncFn = requestCalendarSearchMirrorSync,
}: {
  getHealthFn?: GetHealthFn;
  requestSyncFn?: typeof requestCalendarSearchMirrorSync;
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
}: {
  userId?: string;
  intervalMs?: number;
  getHealthFn?: GetHealthFn;
  requestSyncFn?: typeof requestCalendarSearchMirrorSync;
} = {}) {
  if (!userId || mirrorSyncWorkerTimer) return { started: false };

  requestStartupCalendarSearchMirrorSyncIfNeeded(userId, { getHealthFn, requestSyncFn })
    .catch((err: unknown) => console.error(
      "[Calendar] search mirror startup sync check failed:",
      err instanceof Error ? err.message : String(err),
    ));

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

export async function recordCalendarSearchMirrorSyncRequest(userId: string, {
  dbClient = db,
  accountId = null,
  calendarId = null,
  reason = "calendar-search",
  now = new Date(),
}: {
  dbClient?: MirrorDbClient;
  accountId?: string | null;
  calendarId?: string | null;
  reason?: string;
  now?: Date;
} = {}) {
  if (!userId) return { recorded: false };
  const timestamp = iso(now);
  const filters: string[] = [];
  const args: string[] = [timestamp, reason, timestamp, userId];
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

export async function markCalendarSearchMirrorDirty(userId: string, {
  dbClient = db,
  accountId,
  calendarId,
  reason = "calendar-write",
  now = new Date(),
}: {
  dbClient?: MirrorDbClient;
  accountId?: string;
  calendarId?: string;
  reason?: string;
  now?: Date;
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

export async function upsertCalendarSearchMirrorOccurrence(userId: string, event: MirrorEvent, {
  dbClient = db,
  now = new Date(),
  recordPendingSync = true,
}: { dbClient?: MirrorDbClient; now?: Date; recordPendingSync?: boolean } = {}) {
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

export async function deleteCalendarSearchMirrorOccurrence(userId: string, {
  dbClient = db,
  accountId,
  calendarId,
  eventId,
  originalStartTime = null,
  now = new Date(),
  recordPendingSync = true,
}: {
  dbClient?: MirrorDbClient;
  accountId?: string;
  calendarId?: string;
  eventId?: string;
  originalStartTime?: string | null;
  now?: Date;
  recordPendingSync?: boolean;
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

function rowToOccurrence(row: Row): EventSearchInput {
  return {
    id: String(row.event_id || ""),
    title: String(row.title || "(No title)"),
    location: String(row.location || ""),
    description: String(row.description || ""),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    time: String(row.time_label || ""),
    duration: String(row.duration_label || ""),
    source: String(row.source_label || "Google Calendar"),
    sourceColor: String(row.source_color || "#4285f4"),
    color: String(row.event_color || row.source_color || "#4285f4"),
    colorId: row.color_id ? String(row.color_id) : null,
    accountId: String(row.account_id || ""),
    accountLabel: row.account_label ? String(row.account_label) : "",
    accountEmail: row.account_email ? String(row.account_email) : "",
    calendarId: String(row.calendar_id || ""),
    calendarName: row.source_label ? String(row.source_label) : "",
    allDay: !!row.all_day,
    originalStartTime: row.original_start_key ? String(row.original_start_key) : null,
    recurringEventId: row.recurring_event_id ? String(row.recurring_event_id) : null,
    recurringKind: row.recurring_kind === "series" || row.recurring_kind === "instance" ? row.recurring_kind : null,
    isRecurring: !!row.is_recurring,
    htmlLink: row.html_link ? String(row.html_link) : null,
    openUrl: row.open_url || row.html_link ? String(row.open_url || row.html_link) : null,
  };
}

export async function listCalendarSearchMirrorOccurrences(userId: string, {
  dbClient = db,
  start,
  end,
  query = null,
  limit = 500,
  centerDate = null,
}: {
  dbClient?: MirrorDbClient;
  start?: string;
  end?: string;
  query?: string | null;
  limit?: number;
  centerDate?: string | null;
} = {}) {
  const startMs = dateMs(start || "0001-01-01");
  const endMs = dateMs(end || "9999-12-31", true);
  const normalizedQuery = normalizeText(query);
  // Bind an escaped LIKE pattern with ESCAPE '\' so user `_`/`%` are literal.
  const likePattern = normalizedQuery ? `%${escapeLikePattern(normalizedQuery)}%` : null;
  const querySql = normalizedQuery ? " AND searchable_text LIKE ? ESCAPE '\\'" : "";
  const centerMs = centerDate ? dateMs(centerDate) + (12 * 60 * 60 * 1000) : null;
  const orderSql = Number.isFinite(centerMs)
    ? "ABS(start_ms - ?) ASC, start_ms ASC, title COLLATE NOCASE ASC"
    : "start_ms ASC, title COLLATE NOCASE ASC";
  const result = await dbClient.execute({
    // Explicit projection of exactly the columns rowToOccurrence reads. Avoids
    // pulling the raw_json (≈KB/row) and searchable_text blobs for up to `limit`
    // (up to 1000) rows on every search; neither is read downstream.
    sql: `SELECT event_id, title, location, description, start_ms, end_ms,
                 time_label, duration_label, source_label, source_color,
                 event_color, color_id, account_id, account_label, account_email,
                 calendar_id, all_day, original_start_key, recurring_event_id,
                 recurring_kind, is_recurring, html_link, open_url
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

export async function getCalendarSearchMirrorHealth(userId: string, {
  dbClient = db,
  now = new Date(),
}: { dbClient?: MirrorDbClient; now?: Date } = {}) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_calendar_search_mirror_state
          WHERE user_id = ?
          ORDER BY account_label COLLATE NOCASE ASC, calendar_label COLLATE NOCASE ASC, calendar_id ASC`,
    args: [userId],
  });
  return computeCalendarSearchMirrorHealth(result.rows as unknown as Parameters<typeof computeCalendarSearchMirrorHealth>[0], { now });
}
