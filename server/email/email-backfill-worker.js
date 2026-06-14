import db from "../db/connection.js";
import { decrypt } from "../platform/encryption.js";
import { fetchEmailsInRange as fetchGmailEmailsInRange } from "./gmail.js";
import { fetchEmailsInRange as fetchIcloudEmailsInRange } from "./icloud.js";
import { indexEmails, queueEmailIndexBackfill } from "./email-index.js";

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_TARGET_DAYS = 365;
const DEFAULT_PAUSE_MS = 45_000;

let workerTimer = null;
let workerRunning = false;

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
  };
}

function classifyFailure(err) {
  const message = err?.message || String(err);
  if (/(401|403|429|auth|invalid_grant|rate.?limit)/i.test(message)) {
    return "paused";
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
    return fetchGmailEmailsInRange(account, {
      start: window.start,
      end: window.end,
      pageToken: window.pageToken,
    });
  }
  if (account.type === "icloud") {
    return fetchIcloudEmailsInRange(
      account,
      decrypt(account.credentials_encrypted),
      { start: window.start, end: window.end },
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
  if (result.nextPageToken) {
    nextCursor.nextWindowEnd = window.end;
    nextCursor.pageToken = result.nextPageToken;
  } else {
    nextCursor.nextWindowEnd = window.start;
    if (new Date(window.start) <= window.targetDate) nextStatus = "completed";
  }

  const nextOldestIndexed = oldestEmailDate(emails, state.oldest_indexed_date);
  const completedAt = nextStatus === "completed" ? now.toISOString() : null;
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
  const status = classifyFailure(err);
  const cursor = {
    ...parseCursor(state),
    currentWindow: { start: window.start, end: window.end },
    nextWindowEnd: window.end,
    pageToken: window.pageToken,
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
    await db.execute({
      sql: `UPDATE ea_email_backfill_state
            SET status = 'completed',
                completed_at = ?,
                updated_at = datetime('now')
            WHERE user_id = ? AND account_id = ? AND mailbox_scope = ?`,
      args: [now.toISOString(), state.user_id, state.account_id, state.mailbox_scope],
    });
    return { processed: true, status: "completed", indexed: 0 };
  }

  const account = await loadAccount(state);
  if (!account) {
    const err = new Error(`Email account not found: ${state.account_id}`);
    return persistWindowFailure(state, window, err, attempts);
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
    while (true) {
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
  if (workerTimer || workerRunning) return;
  workerTimer = setTimeout(() => {
    workerTimer = null;
    drainBackfillQueue({ pauseMs }).catch((err) =>
      console.error("[EA Backfill] Queue drain failed:", err.message),
    );
  }, delayMs);
  workerTimer.unref?.();
}

export function startEmailBackfillWorker({
  initialDelayMs = 5000,
  pauseMs = DEFAULT_PAUSE_MS,
  targetDays = DEFAULT_TARGET_DAYS,
  queueOnStartup = parseBooleanEnv(process.env.EA_EMAIL_BACKFILL_QUEUE_ON_STARTUP),
} = {}) {
  prepareEmailBackfillStartup({ queueOnStartup, targetDays })
    .then(() => wakeEmailBackfillWorker({ delayMs: initialDelayMs, pauseMs }))
    .catch((err) => console.error("[EA Backfill] Startup failed:", err.message));
}
