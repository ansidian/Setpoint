import db from "../db/connection.js";
import { getAccessToken, fetchEmails, fetchEmailsByIds, isMessageRead } from "./gmail.js";
import { indexEmails } from "./email-index.js";
import { markProviderRemovedFromActiveSnapshots } from "./snapshot-service.js";

const DEFAULT_GMAIL_TOPIC = process.env.GMAIL_PUBSUB_TOPIC;
const WATCH_RENEWAL_LEAD_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_PAGES = 20;
const GMAIL_HISTORY_RECOVERY_LOOKBACK_HOURS = 14 * 24;

function decodeBase64UrlJson(value) {
  if (!value || typeof value !== "string") {
    throw new Error("Pub/Sub message.data is required");
  }
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (err) {
    throw new Error(`Invalid Pub/Sub Gmail payload: ${err.message}`);
  }
}

export function decodeGmailPubSubNotification(body) {
  const payload = decodeBase64UrlJson(body?.message?.data);
  const emailAddress = String(payload.emailAddress || "").trim().toLowerCase();
  const historyId = String(payload.historyId || "").trim();
  if (!emailAddress || !historyId) {
    throw new Error("Gmail Pub/Sub payload requires emailAddress and historyId");
  }
  return {
    emailAddress,
    historyId,
    pubsubMessageId: body.message?.messageId || body.message?.message_id || null,
    publishTime: body.message?.publishTime || null,
    subscription: body.subscription || null,
  };
}

async function findGmailAccountByEmail(emailAddress, dbClient) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_accounts
          WHERE type = 'gmail'
            AND lower(email) = lower(?)
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1`,
    args: [emailAddress],
  });
  return result.rows[0] || null;
}

export async function enqueueTriageJob({
  userId,
  accountId,
  emailId = null,
  jobType,
  idempotencyKey,
  priority = 3,
  payload = {},
  scheduledFor = null,
}, { dbClient = db } = {}) {
  await dbClient.execute({
    sql: `INSERT INTO ea_triage_jobs
            (user_id, account_id, email_id, job_type, idempotency_key,
             priority, payload_json, scheduled_for)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO NOTHING`,
    args: [
      userId,
      accountId,
      emailId,
      jobType,
      idempotencyKey,
      priority,
      JSON.stringify(payload),
      scheduledFor,
    ],
  });
}

export async function enqueueHistorySyncFromPubSub(body, { dbClient = db } = {}) {
  const notification = decodeGmailPubSubNotification(body);
  const account = await findGmailAccountByEmail(notification.emailAddress, dbClient);
  if (!account) {
    throw new Error(`No Gmail account found for ${notification.emailAddress}`);
  }

  await enqueueTriageJob({
    userId: account.user_id,
    accountId: account.id,
    emailId: null,
    jobType: "gmail_history_sync",
    idempotencyKey: `gmail_history_sync:${account.user_id}:${account.id}:${notification.historyId}`,
    priority: 1,
    payload: {
      emailAddress: notification.emailAddress,
      historyId: notification.historyId,
      pubsubMessageId: notification.pubsubMessageId,
      publishTime: notification.publishTime,
      subscription: notification.subscription,
    },
  }, { dbClient });

  return {
    queued: true,
    account_id: account.id,
    user_id: account.user_id,
    history_id: notification.historyId,
    message_id: notification.pubsubMessageId,
  };
}

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

export async function registerGmailWatch(account, {
  dbClient = db,
  fetchImpl = fetch,
  token,
  topicName = DEFAULT_GMAIL_TOPIC,
  now = new Date(),
} = {}) {
  if (!topicName) {
    throw new Error("GMAIL_PUBSUB_TOPIC is required to register Gmail watches");
  }
  const accessToken = token || await getAccessToken(account);
  const res = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
      topicName,
    }),
  });
  if (!res.ok) {
    const text = await res.text?.();
    throw new Error(`Gmail watch failed for ${account.email}: ${res.status}${text ? ` ${text}` : ""}`);
  }
  const data = await res.json();
  const expirationIso = await persistGmailWatchState(account, {
    historyId: data.historyId,
    expiration: data.expiration,
    status: "active",
    now,
  }, { dbClient });

  return {
    account_id: account.id,
    history_id: String(data.historyId || ""),
    watch_expiration_at: expirationIso,
    status: "active",
  };
}

function collectInboxMessageIds(history = []) {
  const ids = new Set();
  for (const record of history) {
    for (const entry of record.messagesAdded || []) {
      const message = entry.message || {};
      if (message.id && message.labelIds?.includes("INBOX")) ids.add(message.id);
    }
    for (const entry of record.labelsAdded || []) {
      const message = entry.message || {};
      const labels = entry.labelIds || message.labelIds || [];
      if (message.id && labels.includes("INBOX")) ids.add(message.id);
    }
  }
  return [...ids];
}

function eventLabelIds(entry) {
  return entry.labelIds || entry.message?.labelIds || [];
}

function collectUnreadLabelMessageIds(history = []) {
  const ids = new Set();
  for (const record of history) {
    for (const entry of record.labelsAdded || []) {
      if (entry.message?.id && eventLabelIds(entry).includes("UNREAD")) ids.add(entry.message.id);
    }
    for (const entry of record.labelsRemoved || []) {
      if (entry.message?.id && eventLabelIds(entry).includes("UNREAD")) ids.add(entry.message.id);
    }
  }
  return [...ids];
}

function collectProviderRemovalEvents(history = []) {
  const events = new Map();
  const addEvent = (messageId, eventType) => {
    if (!messageId) return;
    const current = events.get(messageId) || new Set();
    current.add(eventType);
    events.set(messageId, current);
  };

  for (const record of history) {
    for (const entry of record.labelsRemoved || []) {
      if (entry.message?.id && eventLabelIds(entry).includes("INBOX")) {
        addEvent(entry.message.id, "inbox_removed");
      }
    }
    for (const entry of record.labelsAdded || []) {
      if (entry.message?.id && eventLabelIds(entry).includes("TRASH")) {
        addEvent(entry.message.id, "trash_added");
      }
    }
    for (const entry of record.messagesDeleted || []) {
      addEvent(entry.message?.id, "message_deleted");
    }
  }
  return events;
}

export async function fetchGmailHistoryPage({
  account,
  startHistoryId,
  pageToken = null,
  fetchImpl = fetch,
  token,
}) {
  const accessToken = token || await getAccessToken(account);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.append("historyTypes", "messageAdded");
  url.searchParams.append("historyTypes", "labelAdded");
  url.searchParams.append("historyTypes", "labelRemoved");
  url.searchParams.append("historyTypes", "messageDeleted");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = new Error(`Gmail history.list failed for ${account.email}: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function fetchGmailMessageMetadata(account, messageId, {
  fetchImpl = fetch,
  token,
} = {}) {
  const accessToken = token || await getAccessToken(account);
  const res = await fetchImpl(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&fields=labelIds`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gmail message metadata failed for ${account.email}/${messageId}: ${res.status}`);
  return res.json();
}

async function getStoredHistoryId(account, dbClient) {
  const result = await dbClient.execute({
    sql: `SELECT last_history_id
          FROM ea_gmail_watch_state
          WHERE user_id = ? AND account_id = ?
          LIMIT 1`,
    args: [account.user_id, account.id],
  });
  return result.rows[0]?.last_history_id || null;
}

function triageStatementsForEmail(userId, accountId, email) {
  const idempotencyKey = `email_triage:${userId}:${accountId}:${email.uid}`;
  const payload = JSON.stringify({
    uid: email.uid,
    subject: email.subject || "",
  });
  return [
    {
      sql: `INSERT OR IGNORE INTO ea_email_triage
              (user_id, account_id, email_id)
            VALUES (?, ?, ?)`,
      args: [userId, accountId, email.uid],
    },
    {
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key,
               priority, payload_json)
            VALUES (?, ?, ?, 'email_triage', ?, 2, ?)
            ON CONFLICT(idempotency_key) DO NOTHING`,
      args: [userId, accountId, email.uid, idempotencyKey, payload],
    },
  ];
}

async function findExistingGmailRowsForMessageIds(account, messageIds, dbClient) {
  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);
  if (!uniqueMessageIds.length) return new Map();

  const result = await dbClient.execute({
    sql: `SELECT uid, account_id, account_email
          FROM ea_email_index
          WHERE user_id = ?
            AND uid LIKE 'gmail-%'
            AND (
              account_id = ?
              OR lower(account_email) = lower(?)
            )`,
    args: [account.user_id, account.id, account.email || ""],
  });
  const rowsByMessageId = new Map();
  for (const messageId of uniqueMessageIds) {
    const suffix = `-${messageId}`;
    const candidates = result.rows.filter((row) => String(row.uid || "").endsWith(suffix));
    if (!candidates.length) continue;
    rowsByMessageId.set(messageId, candidates);
  }
  return rowsByMessageId;
}

async function reconcileReadStateForExistingMessages(account, messageIds, {
  dbClient,
  fetchMessageReadStateFn,
} = {}) {
  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);
  if (!uniqueMessageIds.length) return 0;

  const rowsByMessageId = await findExistingGmailRowsForMessageIds(account, uniqueMessageIds, dbClient);
  const statements = [];
  for (const messageId of uniqueMessageIds) {
    const rows = rowsByMessageId.get(messageId) || [];
    if (!rows.length) continue;
    try {
      const read = await fetchMessageReadStateFn(account, messageId);
      if (read == null) {
        console.warn(`[Gmail Sync] Could not confirm read state for ${account.email}/${messageId}`);
        continue;
      }
      for (const row of rows) {
        statements.push({
          sql: `UPDATE ea_email_index
                SET read = ?
                WHERE user_id = ?
                  AND account_id = ?
                  AND uid = ?`,
          args: [read ? 1 : 0, account.user_id, row.account_id, row.uid],
        });
      }
    } catch (err) {
      console.warn(
        `[Gmail Sync] Failed to reconcile read state for ${account.email}/${messageId}: ${err.message}`,
      );
    }
  }
  if (statements.length) await dbClient.batch(statements);
  return statements.length;
}

function providerStateFromMetadata(metadata) {
  if (!metadata) return null;
  const labels = metadata?.labelIds || [];
  if (labels.includes("TRASH")) return "trashed";
  if (!labels.includes("INBOX")) return "archived";
  return null;
}

async function reconcileProviderRemovalForExistingMessages(account, removalEvents, {
  dbClient,
  fetchMessageMetadataFn,
  now,
} = {}) {
  const messageIds = [...removalEvents.keys()];
  if (!messageIds.length) return 0;

  const rowsByMessageId = await findExistingGmailRowsForMessageIds(account, messageIds, dbClient);
  let removed = 0;
  for (const messageId of messageIds) {
    const rows = rowsByMessageId.get(messageId) || [];
    if (!rows.length) continue;
    const eventTypes = removalEvents.get(messageId) || new Set();
    try {
      const metadata = await fetchMessageMetadataFn(account, messageId);
      let providerState = providerStateFromMetadata(metadata);
      if (!providerState && eventTypes.has("message_deleted")) providerState = "trashed";
      if (!providerState && eventTypes.has("trash_added")) providerState = "trashed";
      if (!providerState && metadata == null && eventTypes.has("inbox_removed")) providerState = "archived";
      if (!providerState) {
        if (metadata == null) {
          console.warn(`[Gmail Sync] Could not confirm provider state for ${account.email}/${messageId}`);
        }
        continue;
      }
      for (const row of rows) {
        await markProviderRemovedFromActiveSnapshots(
          account.user_id,
          row.account_id,
          row.uid,
          providerState,
          { dbClient, now },
        );
        removed++;
      }
    } catch (err) {
      console.warn(
        `[Gmail Sync] Failed to reconcile provider removal for ${account.email}/${messageId}: ${err.message}`,
      );
    }
  }
  return removed;
}

export async function syncGmailHistoryForAccount(account, {
  dbClient = db,
  fetchHistoryPage = fetchGmailHistoryPage,
  fetchEmailsFn = fetchEmails,
  fetchEmailsByIdsFn = fetchEmailsByIds,
  fetchMessageReadStateFn = isMessageRead,
  fetchMessageMetadataFn = fetchGmailMessageMetadata,
  indexEmailsFn = indexEmails,
  targetHistoryId = null,
  now = new Date(),
} = {}) {
  const startHistoryId = await getStoredHistoryId(account, dbClient);
  if (!startHistoryId) {
    if (targetHistoryId) {
      await dbClient.execute({
        sql: `INSERT INTO ea_gmail_watch_state
                (user_id, account_id, email_address, last_history_id,
                 watch_status, last_notification_at)
              VALUES (?, ?, ?, ?, 'inactive', ?)
              ON CONFLICT(user_id, account_id) DO UPDATE SET
                last_history_id = excluded.last_history_id,
                last_notification_at = excluded.last_notification_at,
                updated_at = datetime('now')`,
        args: [account.user_id, account.id, account.email, targetHistoryId, now.toISOString()],
      });
    }
    return {
      account_id: account.id,
      start_history_id: null,
      last_history_id: targetHistoryId,
      indexed: 0,
      queued: 0,
      read_state_reconciled: 0,
      provider_removed: 0,
    };
  }

  const messageIds = new Set();
  const readStateMessageIds = new Set();
  const providerRemovalEvents = new Map();
  let pageToken = null;
  let pages = 0;
  let lastHistoryId = targetHistoryId || startHistoryId;
  try {
    do {
      const page = await fetchHistoryPage({ account, startHistoryId, pageToken });
      for (const id of collectInboxMessageIds(page.history || [])) messageIds.add(id);
      for (const id of collectUnreadLabelMessageIds(page.history || [])) readStateMessageIds.add(id);
      for (const [messageId, eventTypes] of collectProviderRemovalEvents(page.history || [])) {
        const current = providerRemovalEvents.get(messageId) || new Set();
        for (const eventType of eventTypes) current.add(eventType);
        providerRemovalEvents.set(messageId, current);
      }
      lastHistoryId = String(page.historyId || lastHistoryId);
      pageToken = page.nextPageToken || null;
      pages++;
      if (pages >= MAX_HISTORY_PAGES && pageToken) {
        throw new Error(`Gmail history sync hit page cap for ${account.email}`);
      }
    } while (pageToken);
  } catch (err) {
    if (err.status !== 404) throw err;
    const emails = await fetchEmailsFn(account, GMAIL_HISTORY_RECOVERY_LOOKBACK_HOURS);
    if (emails.length) await indexEmailsFn(account.user_id, emails);
    const statements = emails.flatMap((email) =>
      triageStatementsForEmail(account.user_id, account.id, email),
    );
    statements.push({
      sql: `UPDATE ea_gmail_watch_state
            SET last_history_id = ?,
                last_sync_at = ?,
                last_error = ?,
                updated_at = datetime('now')
            WHERE user_id = ? AND account_id = ?`,
      args: [lastHistoryId, now.toISOString(), "", account.user_id, account.id],
    });
    await dbClient.batch(statements);
    return {
      account_id: account.id,
      start_history_id: startHistoryId,
      last_history_id: lastHistoryId,
      indexed: emails.length,
      queued: emails.length,
      read_state_reconciled: 0,
      provider_removed: 0,
      history_recovered: true,
    };
  }

  const emails = await fetchEmailsByIdsFn(account, [...messageIds]);
  if (emails.length) await indexEmailsFn(account.user_id, emails);
  let readStateReconciled = 0;
  try {
    readStateReconciled = await reconcileReadStateForExistingMessages(account, [...readStateMessageIds], {
      dbClient,
      fetchMessageReadStateFn,
    });
  } catch (err) {
    console.warn(`[Gmail Sync] Read-state reconciliation failed for ${account.email}: ${err.message}`);
  }
  let providerRemoved = 0;
  try {
    providerRemoved = await reconcileProviderRemovalForExistingMessages(account, providerRemovalEvents, {
      dbClient,
      fetchMessageMetadataFn,
      now,
    });
  } catch (err) {
    console.warn(`[Gmail Sync] Provider-removal reconciliation failed for ${account.email}: ${err.message}`);
  }

  const statements = emails.flatMap((email) =>
    triageStatementsForEmail(account.user_id, account.id, email),
  );
  statements.push({
    sql: `UPDATE ea_gmail_watch_state
          SET last_history_id = ?,
              last_sync_at = ?,
              last_error = ?,
              updated_at = datetime('now')
          WHERE user_id = ? AND account_id = ?`,
    args: [lastHistoryId, now.toISOString(), "", account.user_id, account.id],
  });
  await dbClient.batch(statements);

  return {
    account_id: account.id,
    start_history_id: startHistoryId,
    last_history_id: lastHistoryId,
    indexed: emails.length,
    queued: emails.length,
    read_state_reconciled: readStateReconciled,
    provider_removed: providerRemoved,
  };
}

export async function enqueueEmailTriageForEmails(userId, emails, {
  dbClient = db,
} = {}) {
  const statements = emails.flatMap((email) =>
    triageStatementsForEmail(userId, email.account_id, email),
  );
  if (statements.length) await dbClient.batch(statements);
  return { queued: emails.length };
}

async function markWatchError(account, message, dbClient) {
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

export async function renewDueGmailWatches({
  dbClient = db,
  now = new Date(),
  renewalLeadMs = WATCH_RENEWAL_LEAD_MS,
  topicName = DEFAULT_GMAIL_TOPIC,
} = {}) {
  if (!topicName) return { checked: 0, renewed: 0, skipped: true };
  const renewBefore = new Date(now.getTime() + renewalLeadMs).toISOString();
  const result = await dbClient.execute({
    sql: `SELECT a.*
          FROM ea_accounts a
          LEFT JOIN ea_gmail_watch_state s
            ON s.user_id = a.user_id AND s.account_id = a.id
          WHERE a.type = 'gmail'
            AND (
              s.account_id IS NULL
              OR s.watch_status != 'active'
              OR s.watch_expiration_at IS NULL
              OR s.watch_expiration_at <= ?
            )
          ORDER BY a.updated_at ASC, a.created_at ASC`,
    args: [renewBefore],
  });

  let renewed = 0;
  for (const account of result.rows) {
    try {
      await registerGmailWatch(account, { dbClient, now, topicName });
      renewed++;
    } catch (err) {
      await markWatchError(account, err.message, dbClient);
      console.error(`[Gmail Watch] Renewal failed for ${account.email}:`, err.message);
    }
  }
  return { checked: result.rows.length, renewed, skipped: false };
}

async function loadGmailAccount(userId, accountId, dbClient) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_accounts
          WHERE user_id = ? AND id = ? AND type = 'gmail'
          LIMIT 1`,
    args: [userId, accountId],
  });
  return result.rows[0] || null;
}

async function claimNextHistorySyncJob(dbClient, now) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_triage_jobs
          WHERE job_type = 'gmail_history_sync'
            AND status = 'queued'
            AND (scheduled_for IS NULL OR scheduled_for <= ?)
          ORDER BY priority ASC, created_at ASC
          LIMIT 1`,
    args: [now.toISOString()],
  });
  const job = result.rows[0] || null;
  if (!job) return null;
  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'running',
              attempts = attempts + 1,
              locked_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND status = 'queued'`,
    args: [now.toISOString(), job.id],
  });
  return job;
}

function parsePayloadJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

export async function processNextGmailHistorySyncJob({
  dbClient = db,
  now = new Date(),
} = {}) {
  const job = await claimNextHistorySyncJob(dbClient, now);
  if (!job) return { processed: false };

  try {
    const account = await loadGmailAccount(job.user_id, job.account_id, dbClient);
    if (!account) throw new Error(`Missing Gmail account ${job.account_id}`);
    const payload = parsePayloadJson(job.payload_json);
    const result = await syncGmailHistoryForAccount(account, {
      dbClient,
      targetHistoryId: payload.historyId || null,
      now,
    });
    await dbClient.execute({
      sql: `UPDATE ea_triage_jobs
            SET status = 'complete',
                completed_at = ?,
                last_error = '',
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [now.toISOString(), job.id],
    });
    return { processed: true, job_id: Number(job.id), result };
  } catch (err) {
    await dbClient.execute({
      sql: `UPDATE ea_triage_jobs
            SET status = 'failed',
                last_error = ?,
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [err.message, job.id],
    });
    throw err;
  }
}
