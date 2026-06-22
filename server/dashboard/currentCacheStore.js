import db from "../db/connection.js";
import {
  CURRENT_CACHE_KEYS,
  expiresAtFor,
  fallbackPayloadForKey,
  hasUsablePayload,
  parsePayload,
} from "./current-sources.js";

// All ea_current_data_cache reads/writes lifted from current-service.js: load the
// cache-key rows, the success upsert, the refresh-failed upsert (degrade-or-fallback),
// and the mark-refreshing batch. The three ON CONFLICT bodies moved byte-for-byte;
// IO is injected ({ dbClient = db, now = new Date() }).

export async function loadCacheRows(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `SELECT user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message,
                 refresh_started_at, last_refresh_failed_at, last_refresh_error, refresh_failure_count
          FROM ea_current_data_cache
          WHERE user_id = ?
            AND cache_key IN (${CURRENT_CACHE_KEYS.map(() => "?").join(",")})`,
    args: [userId, ...CURRENT_CACHE_KEYS],
  });

  return Object.fromEntries(result.rows.map((row) => [row.cache_key, row]));
}

export async function saveCacheRow(userId, cacheKey, payload, {
  dbClient = db,
  now = new Date(),
  status = "current",
  errorMessage = null,
} = {}) {
  const timestamp = now.toISOString();
  await dbClient.execute({
    sql: `INSERT INTO ea_current_data_cache
            (user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message, refresh_started_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(user_id, cache_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at,
            status = excluded.status,
            error_message = excluded.error_message,
            refresh_started_at = NULL,
            last_refresh_failed_at = NULL,
            last_refresh_error = NULL,
            refresh_failure_count = 0,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      cacheKey,
      JSON.stringify(payload),
      timestamp,
      expiresAtFor(cacheKey, now),
      status,
      errorMessage,
      timestamp,
    ],
  });
}

export async function markCacheRowRefreshFailed(userId, cacheKey, err, {
  dbClient = db,
  now = new Date(),
  existingRow = null,
} = {}) {
  const timestamp = now.toISOString();
  const message = String(err?.message || err || "Current data refresh failed").slice(0, 500);
  const usable = hasUsablePayload(cacheKey, existingRow);
  const payload = usable ? parsePayload(existingRow, fallbackPayloadForKey(cacheKey)) : fallbackPayloadForKey(cacheKey);
  const fetchedAt = usable ? existingRow.fetched_at : timestamp;
  const expiresAt = usable ? existingRow.expires_at : expiresAtFor(cacheKey, now);
  const status = usable ? "degraded" : "unavailable";
  const failureCount = Number(existingRow?.refresh_failure_count || 0) + 1;
  await dbClient.execute({
    sql: `INSERT INTO ea_current_data_cache
            (user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message,
             refresh_started_at, last_refresh_failed_at, last_refresh_error,
             refresh_failure_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?)
          ON CONFLICT(user_id, cache_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at,
            status = excluded.status,
            error_message = excluded.error_message,
            refresh_started_at = NULL,
            last_refresh_failed_at = excluded.last_refresh_failed_at,
            last_refresh_error = excluded.last_refresh_error,
            refresh_failure_count = COALESCE(ea_current_data_cache.refresh_failure_count, 0) + 1,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      cacheKey,
      JSON.stringify(payload),
      fetchedAt,
      expiresAt,
      status,
      message,
      timestamp,
      message,
      timestamp,
    ],
  });
  return {
    user_id: userId,
    cache_key: cacheKey,
    payload_json: JSON.stringify(payload),
    fetched_at: fetchedAt,
    expires_at: expiresAt,
    status,
    error_message: message,
    last_refresh_failed_at: timestamp,
    last_refresh_error: message,
    refresh_failure_count: failureCount,
  };
}

export async function markRowsRefreshing(userId, rows, refreshKeys, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const timestamp = now.toISOString();
  const nextRows = { ...rows };
  if (!refreshKeys.length) return nextRows;
  await dbClient.batch(refreshKeys.map((key) => {
    const currentPayload = rows[key]?.payload_json || JSON.stringify(fallbackPayloadForKey(key));
    const fetchedAt = rows[key]?.fetched_at || null;
    const expiresAt = rows[key]?.expires_at || timestamp;
    // Carry refresh_failure_count / last_refresh_failed_at from rows[key] into the
    // in-memory refreshing row so a subsequent markCacheRowRefreshFailed escalates the
    // returned failureCount instead of resetting to 1 (the persisted COALESCE already escalates).
    nextRows[key] = {
      user_id: userId,
      cache_key: key,
      payload_json: currentPayload,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
      status: "refreshing",
      error_message: null,
      refresh_started_at: timestamp,
      last_refresh_failed_at: rows[key]?.last_refresh_failed_at ?? null,
      last_refresh_error: rows[key]?.last_refresh_error ?? null,
      refresh_failure_count: Number(rows[key]?.refresh_failure_count || 0),
    };
    return {
      sql: `INSERT INTO ea_current_data_cache
              (user_id, cache_key, payload_json, fetched_at, expires_at,
               status, error_message, refresh_started_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'refreshing', NULL, ?, ?)
            ON CONFLICT(user_id, cache_key) DO UPDATE SET
              status = 'refreshing',
              error_message = NULL,
              refresh_started_at = excluded.refresh_started_at,
              updated_at = excluded.updated_at`,
      args: [userId, key, currentPayload, fetchedAt, expiresAt, timestamp, timestamp],
    };
  }));
  return nextRows;
}
