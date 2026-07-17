import db from "../db/connection.ts";
import { loadUserConfig } from "../platform/config-service.js";
import {
  iso,
  normalizeText,
  mirrorOccurrenceStatement,
} from "./calendarSearchMirrorStatements.js";
import { computeCalendarSearchMirrorHealth } from "./calendarSearchMirrorHealthModel.js";
import {
  syncCalendarSearchMirror,
  calendarSearchMirrorWindow,
  addMonthsIso,
} from "./calendarSearchMirrorSync.js";

// Re-export the sync-engine surface so the public module path stays unchanged.
export { syncCalendarSearchMirror, calendarSearchMirrorWindow, addMonthsIso };

const DEFAULT_SYNC_DEBOUNCE_MS = 1000;
export const CALENDAR_SEARCH_MIRROR_SYNC_BACKSTOP_MS = 15 * 60 * 1000;

const pendingSyncs = new Map();
const activeSyncs = new Map();
let mirrorSyncWorkerTimer = null;

// Escape LIKE metacharacters so a query containing `_` or `%` matches literally
// instead of acting as a wildcard. Used with `ESCAPE '\'` in
// listCalendarSearchMirrorOccurrences.
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function dateMs(isoDate, end = false) {
  const suffix = end ? "T23:59:59.999Z" : "T00:00:00.000Z";
  return Date.parse(`${isoDate}${suffix}`);
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
  return computeCalendarSearchMirrorHealth(result.rows, { now });
}
