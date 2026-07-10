import db from "../db/connection.js";
import { decrypt } from "../platform/encryption.js";
import { fetchEmailsInRange as fetchGmailEmailsInRange } from "./gmail.js";
import { fetchEmailsInRange as fetchIcloudEmailsInRange } from "./icloud.js";
import { indexEmails, queueEmailIndexBackfill } from "./email-index.js";
import { isInvalidGrantError, markAccountNeedsReauth } from "../platform/provider-reauth.js";

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_TARGET_DAYS = 365;
const DEFAULT_PAUSE_MS = 45_000;
// Per-window page size for iCloud, which fetches a whole window into memory.
// Caps the in-memory array and lets a heavy window page via a continuation
// cursor instead of pulling everything at once (P3-46). Gmail paginates
// natively via nextPageToken so it does not need this.
const ICLOUD_WINDOW_PAGE_LIMIT = 200;
// Non-auth (retry) failures stop retrying after this many attempts so a window
// that keeps failing for a non-recoverable reason cannot loop forever (P3-47).
const MAX_BACKFILL_ATTEMPTS = 5;

let workerTimer = null;
let workerRunning = false;
// REL-03: set by stopEmailBackfillWorker so an in-flight drainBackfillQueue
// loop (bounded by REL-02's fetch deadlines, not aborted here) stops
// re-arming the wake timer once it finishes its current window.
let stopping = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCursor(state) {
  try {
    return JSON.parse(state.cursor_json || "{}");
  } catch {
    return {};
  }
}

function asTargetDate(value) {
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

function calculateWindow(state, { now, windowDays }) {
  const cursor = parseCursor(state);
  const targetDate = asTargetDate(state.oldest_target_date);
  const endDate = new Date(cursor.nextWindowEnd || now.toISOString());
  if (endDate <= targetDate) {
    return { done: true, cursor, targetDate };
  }

  const startDate = new Date(endDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const boundedStart = startDate < targetDate ? targetDate : startDate;
  if (boundedStart >= endDate) {
    return { done: true, cursor, targetDate };
  }

  return {
    done: false,
    cursor,
    targetDate,
    start: boundedStart.toISOString(),
    end: endDate.toISOString(),
    pageToken: cursor.pageToken,
    // Generic per-window continuation cursor (iCloud); paired with pageToken
    // (Gmail) so either provider can page within a window (P3-46).
    providerCursor: cursor.providerCursor,
  };
}

function classifyFailure(err, attempts = 0) {
  const message = err?.message || String(err);
  if (/(401|403|429|auth|invalid_grant|rate.?limit)/i.test(message)) {
    return "paused";
  }
  // Non-auth errors are retryable, but only up to a ceiling. Past it the row
  // goes terminal ('failed') so a stuck window stops being re-selected (P3-47).
  if (attempts >= MAX_BACKFILL_ATTEMPTS) {
    return "failed";
  }
  return "retry";
}

function oldestEmailDate(emails, fallback) {
  const dates = emails
    .map((email) => email.date)
    .filter(Boolean)
    .map((value) => new Date(value).toISOString())
    .sort();
  if (!dates.length) return fallback || null;
  if (!fallback) return dates[0];
  return dates[0] < fallback ? dates[0] : fallback;
}

async function getNextBackfillState() {
  const result = await db.execute({
    sql: `SELECT *
          FROM ea_email_backfill_state
          WHERE status IN ('queued', 'retry')
          ORDER BY updated_at ASC
          LIMIT 1`,
    args: [],
  });
  return result.rows[0] || null;
}

async function markRunning(state, attempts) {
  await db.execute({
    sql: `UPDATE ea_email_backfill_state
          SET status = 'running',
              attempts = ?,
              started_at = COALESCE(started_at, datetime('now')),
              updated_at = datetime('now')
          WHERE user_id = ? AND account_id = ? AND mailbox_scope = ?`,
    args: [attempts, state.user_id, state.account_id, state.mailbox_scope],
  });
}

// Mark a row terminal ('failed') so it is no longer selected by
// getNextBackfillState. Used when the account is gone or attempts are exhausted
// — retrying would loop forever (P3-47).
async function markBackfillFailed(state, attempts, message) {
  await db.execute({
    sql: `UPDATE ea_email_backfill_state
          SET status = 'failed',
              last_error = ?,
              attempts = ?,
              updated_at = datetime('now')
          WHERE user_id = ? AND account_id = ? AND mailbox_scope = ?`,
    args: [message, attempts, state.user_id, state.account_id, state.mailbox_scope],
  });
  return { processed: true, status: "failed", error: message };
}

async function loadAccount(state) {
  const result = await db.execute({
    sql: `SELECT *
          FROM ea_accounts
          WHERE user_id = ? AND id = ? AND type IN ('gmail', 'icloud')`,
    args: [state.user_id, state.account_id],
  });
  return result.rows[0] || null;
}

async function fetchProviderWindow(account, state, window) {
  if (account.type === "gmail") {
    // Gmail already caps each page (maxResults default) and continues via
    // nextPageToken, so it is not the unbounded-array case (P3-46).
    return fetchGmailEmailsInRange(account, {
      start: window.start,
      end: window.end,
      pageToken: window.pageToken,
    });
  }
  if (account.type === "icloud") {
    // Cap the per-window IMAP fetch with a page size and hand back the stored
    // continuation cursor so a heavy window pages instead of pulling an
    // unbounded array into memory (P3-46).
    return fetchIcloudEmailsInRange(
      account,
      decrypt(account.credentials_encrypted),
      {
        start: window.start,
        end: window.end,
        limit: ICLOUD_WINDOW_PAGE_LIMIT,
        cursor: window.providerCursor,
      },
    );
  }
  throw new Error(`Unsupported email account type: ${account.type}`);
}

async function persistWindowSuccess(state, window, result, { now }) {
  const emails = result.emails || [];
  const nextCursor = {
    currentWindow: { start: window.start, end: window.end },
  };
  let nextStatus = "queued";
  // Honor a continuation token from either provider: Gmail's nextPageToken or a
  // generic per-window cursor (iCloud). Either keeps us on the same window so
  // un-returned messages get backfilled instead of being skipped (P3-46).
  if (result.nextPageToken) {
    nextCursor.nextWindowEnd = window.end;
    nextCursor.pageToken = result.nextPageToken;
  } else if (result.cursor) {
    nextCursor.nextWindowEnd = window.end;
    nextCursor.providerCursor = result.cursor;
  } else {
    nextCursor.nextWindowEnd = window.start;
    if (new Date(window.start) <= window.targetDate) nextStatus = "completed";
  }

  // Reaching the target with a cumulative indexed_count of 0 is ambiguous: a
  // genuinely empty mailbox history and a silently failing fetch produce the
  // same "completed, no error" row (audit D4: one account scanned 53 windows,
  // indexed nothing, and reported success). Keep the terminal state but make
  // the emptiness observable as its own status.
  if (nextStatus === "completed" && Number(state.indexed_count || 0) + emails.length === 0) {
    nextStatus = "completed_empty";
  }
  const nextOldestIndexed = oldestEmailDate(emails, state.oldest_indexed_date);
  const completedAt = nextStatus === "completed" || nextStatus === "completed_empty"
    ? now.toISOString()
    : null;
  await db.execute({
    sql: `UPDATE ea_email_backfill_state
          SET status = ?,
              cursor_json = ?,
              indexed_count = indexed_count + ?,
              oldest_indexed_date = ?,
              last_scanned_at = ?,
              last_error = '',
              completed_at = ?,
              updated_at = datetime('now')
          WHERE user_id = ? AND account_id = ? AND mailbox_scope = ?`,
    args: [
      nextStatus,
      JSON.stringify(nextCursor),
      emails.length,
      nextOldestIndexed,
      now.toISOString(),
      completedAt,
      state.user_id,
      state.account_id,
      state.mailbox_scope,
    ],
  });

  return { processed: true, status: nextStatus, indexed: emails.length };
}

async function persistWindowFailure(state, window, err, attempts) {
  const status = classifyFailure(err, attempts);
  if (isInvalidGrantError(err?.message)) {
    try {
      await markAccountNeedsReauth(state.account_id);
    } catch (markErr) {
      console.error("[EA Backfill] Failed to mark needs_reauth:", markErr.message);
    }
  }
  const cursor = {
    ...parseCursor(state),
    currentWindow: { start: window.start, end: window.end },
    nextWindowEnd: window.end,
    pageToken: window.pageToken,
    providerCursor: window.providerCursor,
  };
  await db.execute({
    sql: `UPDATE ea_email_backfill_state
          SET status = ?,
              cursor_json = ?,
              last_error = ?,
              attempts = ?,
              updated_at = datetime('now')
          WHERE user_id = ? AND account_id = ? AND mailbox_scope = ?`,
    args: [
      status,
      JSON.stringify(cursor),
      err?.message || String(err),
      attempts,
      state.user_id,
      state.account_id,
      state.mailbox_scope,
    ],
  });

  return { processed: true, status, error: err?.message || String(err) };
}

export async function processNextBackfillWindow({
  now = new Date(),
  windowDays = DEFAULT_WINDOW_DAYS,
} = {}) {
  const state = await getNextBackfillState();
  if (!state) return { processed: false };

  const attempts = Number(state.attempts || 0) + 1;
  await markRunning(state, attempts);

  const window = calculateWindow(state, { now, windowDays });
  if (window.done) {
    // Same emptiness distinction as persistWindowSuccess: zero ever indexed
    // must not be indistinguishable from a real completion.
    const status = Number(state.indexed_count || 0) > 0 ? "completed" : "completed_empty";
    await db.execute({
      sql: `UPDATE ea_email_backfill_state
            SET status = ?,
                completed_at = ?,
                updated_at = datetime('now')
            WHERE user_id = ? AND account_id = ? AND mailbox_scope = ?`,
      args: [status, now.toISOString(), state.user_id, state.account_id, state.mailbox_scope],
    });
    return { processed: true, status, indexed: 0 };
  }

  const account = await loadAccount(state);
  if (!account) {
    // The account was deleted. There is nothing left to backfill, so go
    // terminal instead of treating provider-not-found as retryable and looping
    // forever on a deleted account (P3-47).
    return markBackfillFailed(
      state,
      attempts,
      `Email account not found: ${state.account_id}`,
    );
  }

  try {
    const result = await fetchProviderWindow(account, state, window);
    const emails = result.emails || [];
    if (emails.length) await indexEmails(state.user_id, emails);
    return persistWindowSuccess(state, window, result, { now });
  } catch (err) {
    return persistWindowFailure(state, window, err, attempts);
  }
}

export async function resumeInterruptedBackfills() {
  await db.execute({
    sql: `UPDATE ea_email_backfill_state
          SET status = 'retry',
              last_error = 'Backfill interrupted before completion',
              updated_at = datetime('now')
          WHERE status = 'running'`,
    args: [],
  });
}

export async function enqueueBackfillForAllUsers({ targetDays = DEFAULT_TARGET_DAYS } = {}) {
  const result = await db.execute({
    sql: "SELECT DISTINCT user_id FROM ea_accounts WHERE type IN ('gmail', 'icloud')",
    args: [],
  });
  for (const row of result.rows) {
    await queueEmailIndexBackfill(row.user_id, { targetDays });
  }
}

function parseBooleanEnv(value) {
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

export async function prepareEmailBackfillStartup({
  queueOnStartup = parseBooleanEnv(process.env.EA_EMAIL_BACKFILL_QUEUE_ON_STARTUP),
  targetDays = DEFAULT_TARGET_DAYS,
} = {}) {
  await resumeInterruptedBackfills();
  if (!queueOnStartup) {
    return { resumed: true, queued: false };
  }
  await enqueueBackfillForAllUsers({ targetDays });
  return { resumed: true, queued: true };
}

async function drainBackfillQueue({ pauseMs = DEFAULT_PAUSE_MS } = {}) {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (!stopping) {
      const result = await processNextBackfillWindow();
      if (!result.processed) break;
      if (result.status === "paused") continue;
      await sleep(pauseMs);
    }
  } catch (err) {
    console.error("[EA Backfill] Worker failed:", err.message);
  } finally {
    workerRunning = false;
  }
}

export function wakeEmailBackfillWorker({ delayMs = 0, pauseMs = DEFAULT_PAUSE_MS } = {}) {
  if (stopping || workerTimer || workerRunning) return;
  workerTimer = setTimeout(() => {
    workerTimer = null;
    drainBackfillQueue({ pauseMs }).catch((err) =>
      console.error("[EA Backfill] Queue drain failed:", err.message),
    );
  }, delayMs);
  workerTimer.unref?.();
}

// REL-03: stop the wake timer from firing and prevent any further re-arming.
// Does not abort a drain loop already in flight — REL-02's fetch deadlines
// already bound each window, and the `stopping` check above/in the drain loop
// stops it from picking up further windows once the current one finishes.
// Idempotent — safe to call twice.
export function stopEmailBackfillWorker() {
  stopping = true;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
}

export function startEmailBackfillWorker({
  initialDelayMs = 5000,
  pauseMs = DEFAULT_PAUSE_MS,
  targetDays = DEFAULT_TARGET_DAYS,
  queueOnStartup = parseBooleanEnv(process.env.EA_EMAIL_BACKFILL_QUEUE_ON_STARTUP),
} = {}) {
  // Idempotent restart: clear a prior stopEmailBackfillWorker() latch so a
  // fresh start can re-arm the wake timer (wakeEmailBackfillWorker itself
  // stays a no-op post-stop for any other caller).
  stopping = false;
  prepareEmailBackfillStartup({ queueOnStartup, targetDays })
    .then(() => wakeEmailBackfillWorker({ delayMs: initialDelayMs, pauseMs }))
    .catch((err) => console.error("[EA Backfill] Startup failed:", err.message));
}
