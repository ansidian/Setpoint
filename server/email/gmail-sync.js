import db from "../db/connection.js";
import { getAccessToken, fetchEmails, fetchEmailsByIds, isMessageRead, chunkArray } from "./gmail.js";
import { indexEmails } from "./email-index.js";
import {
  attachArrivalGraceEmailToActiveSnapshot,
  markProviderRemovedFromActiveSnapshots,
  getOrCreateActiveSnapshot,
} from "../snapshots/snapshot-service.js";
import { ARRIVAL_GRACE_SOURCE, arrivalGraceDeadline } from "../snapshots/arrival-grace.js";

const DEFAULT_GMAIL_TOPIC = process.env.GMAIL_PUBSUB_TOPIC;
const WATCH_RENEWAL_LEAD_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_PAGES = 20;
const GMAIL_HISTORY_RECOVERY_LOOKBACK_HOURS = 14 * 24;
// SQLite caps bound parameters per statement; chunk uid IN lists to stay well
// under it (mirrors EMAIL_INDEX_LOOKUP_CHUNK_SIZE in email-index.js).
const GMAIL_ROW_LOOKUP_CHUNK_SIZE = 500;
// Bound the parallel per-message metadata fetches during reconciliation (mirrors
// the chunk size fetchMessages uses) so a large label-change burst does not open
// hundreds of simultaneous Gmail requests.
const GMAIL_METADATA_FETCH_CHUNK_SIZE = 15;

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

// MERGE-NOTE[P3-75] (P3 worktree): new helper that returns the account's CURRENT
// historyId via users.getProfile, used by the 404-recovery branch so it never
// re-persists the stale cursor that just 404'd. Shares this file with two P2
// gmail-sync fixes on other worktrees; this is a new function (no overlap) — keep both.
export async function fetchGmailProfileHistoryId(account, {
  fetchImpl = fetch,
  token,
} = {}) {
  const accessToken = token || await getAccessToken(account);
  const res = await fetchImpl(
    "https://www.googleapis.com/gmail/v1/users/me/profile?fields=historyId",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Gmail profile fetch failed for ${account.email}: ${res.status}`);
  const profile = await res.json();
  const historyId = profile?.historyId ? String(profile.historyId) : null;
  return historyId;
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

function triageStatementsForEmail(userId, accountId, email, {
  arrivalGrace = false,
  now = new Date(),
} = {}) {
  const idempotencyKey = `email_triage:${userId}:${accountId}:${email.uid}`;
  const scheduledFor = arrivalGrace ? arrivalGraceDeadline(now) : null;
  const payload = JSON.stringify({
    uid: email.uid,
    subject: email.subject || "",
    ...(arrivalGrace
      ? {
          arrivalGrace: true,
          queuedAt: now.toISOString(),
          graceDeadline: scheduledFor,
        }
      : {}),
  });
  return [
    {
      sql: `INSERT OR IGNORE INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source)
            VALUES (?, ?, ?, 'pending', ?)`,
      args: [userId, accountId, email.uid, arrivalGrace ? ARRIVAL_GRACE_SOURCE : "unknown"],
    },
    {
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key,
               priority, payload_json, scheduled_for)
            VALUES (?, ?, ?, 'email_triage', ?, 2, ?, ?)
            ON CONFLICT(idempotency_key) DO NOTHING`,
      args: [userId, accountId, email.uid, idempotencyKey, payload, scheduledFor],
    },
  ];
}

// Resolve every account_id that holds indexed rows for this Gmail mailbox: the
// synced account plus any sibling ids carrying the same canonical email under a
// stale account_id (re-OAuth / canonical drift). One DISTINCT lookup returns a
// tiny id set instead of the wide all-rows scan the caller used to materialize.
async function resolveGmailMailboxAccountIds(account, dbClient) {
  const ids = new Set();
  for (const id of [account.id, account.uid_account_id, account.canonical_id]) {
    if (id) ids.add(id);
  }
  const email = account.email || "";
  if (email) {
    const result = await dbClient.execute({
      sql: `SELECT DISTINCT account_id
            FROM ea_email_index
            WHERE user_id = ?
              AND uid LIKE 'gmail-%'
              AND lower(account_email) = lower(?)`,
      args: [account.user_id, email],
    });
    for (const row of result.rows) {
      if (row.account_id) ids.add(row.account_id);
    }
  }
  return [...ids];
}

async function findExistingGmailRowsForMessageIds(account, messageIds, dbClient) {
  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);
  if (!uniqueMessageIds.length) return new Map();

  // P1-5: query the uid PRIMARY KEY with chunked IN lists for exactly the
  // candidate uids (gmail-<accountId>-<messageId>) instead of scanning the whole
  // gmail slice of ea_email_index and filtering messageIds in JS. Candidate uids
  // are built from (accountId, messageId) pairs and mapped back to their
  // messageId, which is robust to account_ids that themselves contain dashes.
  const accountIds = await resolveGmailMailboxAccountIds(account, dbClient);
  if (!accountIds.length) return new Map();

  const uidToMessageId = new Map();
  for (const accountId of accountIds) {
    for (const messageId of uniqueMessageIds) {
      uidToMessageId.set(`gmail-${accountId}-${messageId}`, messageId);
    }
  }
  const candidateUids = [...uidToMessageId.keys()];

  const rowsByMessageId = new Map();
  for (let i = 0; i < candidateUids.length; i += GMAIL_ROW_LOOKUP_CHUNK_SIZE) {
    const chunk = candidateUids.slice(i, i + GMAIL_ROW_LOOKUP_CHUNK_SIZE);
    const result = await dbClient.execute({
      sql: `SELECT uid, account_id, account_email
            FROM ea_email_index
            WHERE user_id = ?
              AND uid IN (${chunk.map(() => "?").join(",")})`,
      args: [account.user_id, ...chunk],
    });
    for (const row of result.rows) {
      const messageId = uidToMessageId.get(row.uid);
      if (!messageId) continue;
      const bucket = rowsByMessageId.get(messageId);
      if (bucket) bucket.push(row);
      else rowsByMessageId.set(messageId, [row]);
    }
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
  const pendingIds = uniqueMessageIds.filter((messageId) => (rowsByMessageId.get(messageId) || []).length);
  if (!pendingIds.length) return 0;

  // P2-13: fetch the authoritative per-message read state in bounded parallel
  // chunks instead of one serial GET per id; build the UPDATE statements from the
  // resolved results, then apply them in a single batch as before.
  const statements = [];
  for (const chunk of chunkArray(pendingIds, GMAIL_METADATA_FETCH_CHUNK_SIZE)) {
    const results = await Promise.all(chunk.map((messageId) =>
      Promise.resolve()
        .then(() => fetchMessageReadStateFn(account, messageId))
        .then((read) => ({ messageId, read }))
        .catch((err) => ({ messageId, error: err })),
    ));
    for (const { messageId, read, error } of results) {
      if (error) {
        console.warn(
          `[Gmail Sync] Failed to reconcile read state for ${account.email}/${messageId}: ${error.message}`,
        );
        continue;
      }
      if (read == null) {
        console.warn(`[Gmail Sync] Could not confirm read state for ${account.email}/${messageId}`);
        continue;
      }
      for (const row of rowsByMessageId.get(messageId) || []) {
        statements.push({
          sql: `UPDATE ea_email_index
                SET read = ?
                WHERE user_id = ?
                  AND account_id = ?
                  AND uid = ?`,
          args: [read ? 1 : 0, account.user_id, row.account_id, row.uid],
        });
      }
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
  const pendingIds = messageIds.filter((messageId) => (rowsByMessageId.get(messageId) || []).length);
  if (!pendingIds.length) return 0;

  // P2-13: fetch each message's metadata in bounded parallel chunks; the snapshot
  // write-backs (markProviderRemovedFromActiveSnapshots) still run sequentially
  // after the fetch so ordering and the removed count are unchanged.
  let removed = 0;
  for (const chunk of chunkArray(pendingIds, GMAIL_METADATA_FETCH_CHUNK_SIZE)) {
    const results = await Promise.all(chunk.map((messageId) =>
      Promise.resolve()
        .then(() => fetchMessageMetadataFn(account, messageId))
        .then((metadata) => ({ messageId, metadata }))
        .catch((err) => ({ messageId, error: err })),
    ));
    for (const { messageId, metadata, error } of results) {
      if (error) {
        console.warn(
          `[Gmail Sync] Failed to reconcile provider removal for ${account.email}/${messageId}: ${error.message}`,
        );
        continue;
      }
      const eventTypes = removalEvents.get(messageId) || new Set();
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
      for (const row of rowsByMessageId.get(messageId) || []) {
        await markProviderRemovedFromActiveSnapshots(
          account.user_id,
          row.account_id,
          row.uid,
          providerState,
          { dbClient, now },
        );
        removed++;
      }
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
  fetchProfileHistoryIdFn = fetchGmailProfileHistoryId,
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
        // Too many history pages between syncs: recover via the lookback re-fetch
        // (same as the 404 path) instead of throwing away all collected progress
        // and leaving the cursor stuck so new mail never indexes.
        const capError = new Error(`Gmail history sync hit page cap for ${account.email}`);
        capError.recoverViaLookback = true;
        throw capError;
      }
    } while (pageToken);
  } catch (err) {
    // P2-26 broadened this catch to also handle the page-cap recovery path
    // (err.recoverViaLookback, thrown above) — not just a 404 — so both reach the
    // lookback re-fetch below instead of discarding collected progress.
    if (err.status !== 404 && !err.recoverViaLookback) throw err;
    // P3-75: recovery must NEVER persist the cursor that just 404'd (startHistoryId
    // / a page-derived id). Persist the freshest KNOWN id: prefer targetHistoryId,
    // else the account's current historyId from users.getProfile.
    let recoveredHistoryId = targetHistoryId || null;
    if (!recoveredHistoryId) {
      try {
        recoveredHistoryId = await fetchProfileHistoryIdFn(account);
      } catch (profileErr) {
        console.warn(
          `[Gmail Sync] Could not fetch current historyId for ${account.email} during 404 recovery: ${profileErr.message}`,
        );
      }
    }
    const emails = await fetchEmailsFn(account, GMAIL_HISTORY_RECOVERY_LOOKBACK_HOURS);
    if (emails.length) await indexEmailsFn(account.user_id, emails);
    const statements = emails.flatMap((email) =>
      triageStatementsForEmail(account.user_id, account.id, email, { arrivalGrace: false, now }),
    );
    // Only advance the cursor when we resolved a fresh id; otherwise leave the stored
    // cursor untouched so we don't re-write the stale 404'd value and re-trigger backfill.
    if (recoveredHistoryId) {
      statements.push({
        sql: `UPDATE ea_gmail_watch_state
              SET last_history_id = ?,
                  last_sync_at = ?,
                  last_error = ?,
                  updated_at = datetime('now')
              WHERE user_id = ? AND account_id = ?`,
        args: [recoveredHistoryId, now.toISOString(), "", account.user_id, account.id],
      });
    } else {
      statements.push({
        sql: `UPDATE ea_gmail_watch_state
              SET last_sync_at = ?,
                  last_error = ?,
                  updated_at = datetime('now')
              WHERE user_id = ? AND account_id = ?`,
        args: [now.toISOString(), "", account.user_id, account.id],
      });
    }
    await dbClient.batch(statements);
    return {
      account_id: account.id,
      start_history_id: startHistoryId,
      last_history_id: recoveredHistoryId || startHistoryId,
      indexed: emails.length,
      queued: emails.length,
      read_state_reconciled: 0,
      provider_removed: 0,
      history_recovered: true,
    };
  }

  const requestedIds = [...messageIds];
  let emails = await fetchEmailsByIdsFn(account, requestedIds);
  if (requestedIds.length && emails.length < requestedIds.length) {
    // One bounded retry: a transient per-message fetch failure (429/5xx) would
    // otherwise be skipped permanently once the history cursor advances past it.
    const merged = new Map(emails.map((email) => [email.uid, email]));
    for (const email of await fetchEmailsByIdsFn(account, requestedIds)) merged.set(email.uid, email);
    emails = [...merged.values()];
  }
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
    triageStatementsForEmail(account.user_id, account.id, email, { arrivalGrace: true, now }),
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
  if (emails.length) {
    // P2-23: resolve the active snapshot once for the whole batch instead of
    // re-resolving it (3 queries) inside attach for every new email.
    const snapshot = await getOrCreateActiveSnapshot(account.user_id, { dbClient, now });
    for (const email of emails) {
      await attachArrivalGraceEmailToActiveSnapshot(account.user_id, account.id, email, {
        dbClient,
        now,
        snapshot,
      });
    }
  }

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
  now = new Date(),
  arrivalGrace = true,
} = {}) {
  const statements = emails.flatMap((email) =>
    triageStatementsForEmail(userId, email.account_id, email, { arrivalGrace, now }),
  );
  if (statements.length) await dbClient.batch(statements);
  if (arrivalGrace && emails.length) {
    // P2-23: hoist active-snapshot resolution out of the per-email loop.
    const snapshot = await getOrCreateActiveSnapshot(userId, { dbClient, now });
    for (const email of emails) {
      await attachArrivalGraceEmailToActiveSnapshot(userId, email.account_id, email, {
        dbClient,
        now,
        snapshot,
      });
    }
  }
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
    // MERGE-NOTE[P3-75] (P3 worktree): defense in depth — a gmail_history_sync job whose
    // payload lacks a historyId can't advance the cursor and would force a 404-recovery
    // backfill; skip it instead of running. Shares this file with two P2 gmail-sync fixes
    // on other worktrees; new guard region — keep both. Remove this note after merge.
    const targetHistoryId = payload.historyId ? String(payload.historyId).trim() : "";
    if (!targetHistoryId) {
      // Mirror triage-worker no-op convention: terminal 'complete' status so the claim
      // query never re-picks it, with skipped:true surfaced in the return value.
      await dbClient.execute({
        sql: `UPDATE ea_triage_jobs
              SET status = 'complete',
                  completed_at = ?,
                  last_error = 'missing historyId in payload',
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [now.toISOString(), job.id],
      });
      return { processed: true, job_id: Number(job.id), skipped: true };
    }
    const result = await syncGmailHistoryForAccount(account, {
      dbClient,
      targetHistoryId,
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
