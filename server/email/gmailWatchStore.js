import db from "../db/connection.ts";

// All ea_gmail_watch_state persistence lifted from gmail-sync.js: watch-state
// upsert, stored-cursor read, watch-error write, and the cursor statement builders
// the sync orchestrator composes into its batches. SQL moved verbatim.

function watchExpirationIso(expiration) {
  const millis = Number(expiration);
  if (!Number.isFinite(millis)) {
    throw new Error("Gmail watch response missing numeric expiration");
  }
  return new Date(millis).toISOString();
}

export async function persistGmailWatchState(account, {
  historyId,
  expiration,
  status = "active",
  lastError = "",
  now = new Date(),
}, { dbClient = db } = {}) {
  const expirationIso = watchExpirationIso(expiration);
  const renewedAt = now.toISOString();
  await dbClient.execute({
    sql: `INSERT INTO ea_gmail_watch_state
            (user_id, account_id, email_address, last_history_id,
             watch_expiration_at, watch_status, last_renewed_at, last_error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, account_id) DO UPDATE SET
            email_address = excluded.email_address,
            last_history_id = excluded.last_history_id,
            watch_expiration_at = excluded.watch_expiration_at,
            watch_status = excluded.watch_status,
            last_renewed_at = excluded.last_renewed_at,
            last_error = excluded.last_error,
            updated_at = datetime('now')`,
    args: [
      account.user_id,
      account.id,
      account.email,
      String(historyId || ""),
      expirationIso,
      status,
      renewedAt,
      lastError,
    ],
  });
  return expirationIso;
}

export async function getStoredHistoryId(account, dbClient) {
  const result = await dbClient.execute({
    sql: `SELECT last_history_id
          FROM ea_gmail_watch_state
          WHERE user_id = ? AND account_id = ?
          LIMIT 1`,
    args: [account.user_id, account.id],
  });
  return result.rows[0]?.last_history_id || null;
}

export async function markWatchError(account, message, dbClient) {
  await dbClient.execute({
    sql: `INSERT INTO ea_gmail_watch_state
            (user_id, account_id, email_address, watch_status, last_error)
          VALUES (?, ?, ?, 'error', ?)
          ON CONFLICT(user_id, account_id) DO UPDATE SET
            watch_status = 'error',
            last_error = excluded.last_error,
            updated_at = datetime('now')`,
    args: [account.user_id, account.id, account.email, message],
  });
}

// The first-sync seed: store the target historyId as an inactive watch so the
// next push has a cursor to page from. Verbatim from the syncGmailHistoryForAccount
// no-stored-cursor branch.
export function seedInactiveWatchStateStatement({ account, targetHistoryId, now }) {
  return {
    sql: `INSERT INTO ea_gmail_watch_state
            (user_id, account_id, email_address, last_history_id,
             watch_status, last_notification_at)
          VALUES (?, ?, ?, ?, 'inactive', ?)
          ON CONFLICT(user_id, account_id) DO UPDATE SET
            last_history_id = excluded.last_history_id,
            last_notification_at = excluded.last_notification_at,
            updated_at = datetime('now')`,
    args: [account.user_id, account.id, account.email, targetHistoryId, now.toISOString()],
  };
}

// Advance the cursor to a resolved historyId. Used by BOTH the normal-path
// advance and the 404/page-cap recovery-with-id path — the SQL is byte-identical
// (only the JS value feeding `historyId` differs).
export function advanceCursorStatement({ historyId, account, now }) {
  return {
    sql: `UPDATE ea_gmail_watch_state
          SET last_history_id = ?,
              last_sync_at = ?,
              last_error = ?,
              updated_at = datetime('now')
          WHERE user_id = ? AND account_id = ?`,
    args: [historyId, now.toISOString(), "", account.user_id, account.id],
  };
}

// Recovery with no resolved historyId: touch last_sync_at/last_error but leave the
// stored cursor untouched so the stale 404'd value is not re-written.
export function touchCursorStatement({ account, now }) {
  return {
    sql: `UPDATE ea_gmail_watch_state
          SET last_sync_at = ?,
              last_error = ?,
              updated_at = datetime('now')
          WHERE user_id = ? AND account_id = ?`,
    args: [now.toISOString(), "", account.user_id, account.id],
  };
}
