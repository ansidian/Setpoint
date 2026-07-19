import db from "../db/connection.ts";
import { fetchEmails, fetchEmailsByIds, isMessageRead } from "./gmail.ts";
import { indexEmails } from "./email-index.ts";
import {
  attachArrivalGraceEmailToActiveSnapshot,
  getOrCreateActiveSnapshot,
} from "../snapshots/snapshot-service.ts";
import { arrivalGraceDeadline, triageStatementsForEmail } from "./gmailTriageStatements.ts";
import { decodeGmailPubSubNotification } from "./gmailPubSubNotification.ts";
export { decodeGmailPubSubNotification } from "./gmailPubSubNotification.ts";
import {
  collectInboxMessageIds,
  collectUnreadLabelMessageIds,
  collectProviderRemovalEvents,
} from "./gmailHistoryProjection.ts";
import {
  reconcileReadStateForExistingMessages,
  reconcileProviderRemovalForExistingMessages,
} from "./gmailReconciliation.ts";
import {
  fetchGmailHistoryPage,
  fetchGmailMessageMetadata,
  fetchGmailProfileHistoryId,
  requestGmailWatch,
} from "./gmailSyncClient.ts";
export {
  fetchGmailHistoryPage,
  fetchGmailMessageMetadata,
  fetchGmailProfileHistoryId,
} from "./gmailSyncClient.ts";
import {
  persistGmailWatchState,
  getStoredHistoryId,
  markWatchError,
  seedInactiveWatchStateStatement,
  advanceCursorStatement,
  touchCursorStatement,
} from "./gmailWatchStore.ts";
export { persistGmailWatchState } from "./gmailWatchStore.ts";
import { isInvalidGrantError, markAccountNeedsReauth } from "../platform/provider-reauth.ts";
import { logTiming } from "../timing.ts";
import { projectEmailArrivalTiming } from "./email-arrival-timing.ts";
import { triageRetryBackoffIso } from "../triage/triage-worker.ts";
import { requestEmailTriageDrainAt } from "../scheduler-email-triage-drain.ts";
import type { InStatement } from "@libsql/client";
import type { Client } from "@libsql/client";
import type { NormalizedFetchedEmail } from "../../shared/types/email.ts";
import type { ConfiguredEmailAccount } from "./email-provider-types.ts";
import type { EmailWriteDb } from "./email-persistence-types.ts";
import type {
  EmailFetch,
  GmailHistoryPage,
  GmailMessageMetadata,
  GmailProviderRemovalEvent,
  GmailSyncAccount,
  GmailSyncError,
} from "./email-sync-types.ts";
import { syncErrorMessage } from "./email-sync-types.ts";
interface GmailHistorySyncSummary {
  account_id?: string;
  start_history_id?: string | null;
  last_history_id?: string | null;
  indexed: number;
  queued: number;
  read_state_reconciled?: number;
  provider_removed?: number;
  history_recovered?: boolean;
  snapshot_queued_at?: unknown;
}

interface GmailHistoryJobRow extends Record<string, unknown> {
  id: number | string;
  user_id: string;
  account_id: string;
  payload_json?: string | null;
  created_at?: string | null;
  attempts?: number | string | null;
}

interface EnqueueTriageJobInput {
  userId: string;
  accountId: string;
  emailId?: string | null;
  jobType: string;
  idempotencyKey: string;
  priority?: number;
  payload?: Record<string, unknown>;
  scheduledFor?: string | null;
}

interface EmailTriageCandidate extends Record<string, unknown> {
  uid: string;
  account_id: string;
  subject?: string;
}
const WATCH_RENEWAL_LEAD_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_PAGES = 20;
const GMAIL_HISTORY_RECOVERY_LOOKBACK_HOURS = 14 * 24;
// CORR-L08: gmail_history_sync jobs retried forever on a plain terminal-failure
// catch (attempts tracked but never checked). Cap retries like the triage queue
// sharing this same ea_triage_jobs table (triage-job-store.ts's own 5-attempt
// ceiling) instead of inventing a second backoff formula.
const MAX_GMAIL_HISTORY_SYNC_ATTEMPTS = 5;
const historySyncTimingByResult = new WeakMap<object, { snapshotQueuedAt: Date }>();

async function findGmailAccountByEmail(emailAddress: string, dbClient: EmailWriteDb): Promise<GmailSyncAccount | null> {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_accounts
          WHERE type = 'gmail'
            AND lower(email) = lower(?)
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1`,
    args: [emailAddress],
  });
  return result.rows[0] as unknown as GmailSyncAccount || null;
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
}: EnqueueTriageJobInput, { dbClient = db }: { dbClient?: EmailWriteDb } = {}): Promise<void> {
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

export async function enqueueHistorySyncFromPubSub(body: Parameters<typeof decodeGmailPubSubNotification>[0], { dbClient = db }: { dbClient?: EmailWriteDb } = {}) {
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

export async function registerGmailWatch(account: GmailSyncAccount, {
  dbClient = db,
  fetchImpl = fetch,
  token,
  topicName,
  now = new Date(),
}: { dbClient?: EmailWriteDb; fetchImpl?: EmailFetch; token?: string; topicName?: string; now?: Date } = {}) {
  if (!topicName) {
    throw new Error("GMAIL_PUBSUB_TOPIC is required to register Gmail watches");
  }
  const data = await requestGmailWatch(account, { fetchImpl, token, topicName });
  const expirationIso = await persistGmailWatchState(account, {
    historyId: data.historyId,
    expiration: data.expiration!,
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

export async function syncGmailHistoryForAccount(account: GmailSyncAccount, {
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
  timingNow = () => new Date(),
  requestEmailTriageDrainAtFn = requestEmailTriageDrainAt,
}: {
  dbClient?: Partial<EmailWriteDb> | null;
  fetchHistoryPage?: (input: { account: GmailSyncAccount; startHistoryId: string; pageToken: string | null }) => Promise<GmailHistoryPage>;
  fetchEmailsFn?: (account: ConfiguredEmailAccount, hoursBack: number) => Promise<NormalizedFetchedEmail[]>;
  fetchEmailsByIdsFn?: (account: ConfiguredEmailAccount, ids: string[]) => Promise<NormalizedFetchedEmail[]>;
  fetchMessageReadStateFn?: (account: ConfiguredEmailAccount, id: string) => Promise<boolean | null>;
  fetchMessageMetadataFn?: (account: GmailSyncAccount, id: string) => Promise<GmailMessageMetadata | null>;
  fetchProfileHistoryIdFn?: (account: GmailSyncAccount) => Promise<string | null>;
  indexEmailsFn?: (userId: string, emails: NormalizedFetchedEmail[], options?: { dbClient?: EmailWriteDb }) => Promise<void>;
  targetHistoryId?: string | null;
  now?: Date;
  timingNow?: () => Date;
  requestEmailTriageDrainAtFn?: (deadline: string) => unknown;
} = {}): Promise<GmailHistorySyncSummary> {
  const database = dbClient as EmailWriteDb;
  const startHistoryId = await getStoredHistoryId(account, database);
  if (!startHistoryId) {
    if (targetHistoryId) {
      await database.execute(seedInactiveWatchStateStatement({ account, targetHistoryId, now }));
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

  const messageIds = new Set<string>();
  const readStateMessageIds = new Set<string>();
  const providerRemovalEvents = new Map<string, Set<GmailProviderRemovalEvent>>();
  let pageToken: string | null = null;
  let pages = 0;
  let lastHistoryId = targetHistoryId || startHistoryId;
  try {
    do {
      const page = await fetchHistoryPage({ account, startHistoryId, pageToken });
      for (const id of collectInboxMessageIds(page.history || [])) messageIds.add(id);
      for (const id of collectUnreadLabelMessageIds(page.history || [])) readStateMessageIds.add(id);
      for (const [messageId, eventTypes] of collectProviderRemovalEvents(page.history || [])) {
        const current = providerRemovalEvents.get(messageId) || new Set<GmailProviderRemovalEvent>();
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
        const capError = new Error(`Gmail history sync hit page cap for ${account.email}`) as GmailSyncError;
        capError.recoverViaLookback = true;
        throw capError;
      }
    } while (pageToken);
  } catch (error) {
    const err = error as GmailSyncError;
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
          `[Gmail Sync] Could not fetch current historyId for ${account.email} during 404 recovery: ${syncErrorMessage(profileErr)}`,
        );
      }
    }
    const emails = await fetchEmailsFn(account as ConfiguredEmailAccount, GMAIL_HISTORY_RECOVERY_LOOKBACK_HOURS);
    if (emails.length) await indexEmailsFn(account.user_id, emails);
    const statements: InStatement[] = emails.flatMap((email) =>
      triageStatementsForEmail(account.user_id, account.id, email, { arrivalGrace: false, now }),
    );
    // Only advance the cursor when we resolved a fresh id; otherwise leave the stored
    // cursor untouched so we don't re-write the stale 404'd value and re-trigger backfill.
    if (recoveredHistoryId) {
      statements.push(advanceCursorStatement({ historyId: recoveredHistoryId, account, now }));
    } else {
      statements.push(touchCursorStatement({ account, now }));
    }
    await database.batch(statements);
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
  let emails = await fetchEmailsByIdsFn(account as ConfiguredEmailAccount, requestedIds);
  if (requestedIds.length && emails.length < requestedIds.length) {
    // One bounded retry: a transient per-message fetch failure (429/5xx) would
    // otherwise be skipped permanently once the history cursor advances past it.
    const merged = new Map(emails.map((email) => [email.uid, email]));
    for (const email of await fetchEmailsByIdsFn(account as ConfiguredEmailAccount, requestedIds)) merged.set(email.uid, email);
    emails = [...merged.values()];
  }
  if (emails.length) await indexEmailsFn(account.user_id, emails);
  let readStateReconciled = 0;
  try {
    readStateReconciled = await reconcileReadStateForExistingMessages(account, [...readStateMessageIds], {
      dbClient: database,
      fetchMessageReadStateFn: fetchMessageReadStateFn as (account: GmailSyncAccount, id: string) => Promise<boolean | null>,
    });
  } catch (err) {
    console.warn(`[Gmail Sync] Read-state reconciliation failed for ${account.email}: ${syncErrorMessage(err)}`);
  }
  let providerRemoved = 0;
  try {
    providerRemoved = await reconcileProviderRemovalForExistingMessages(account, providerRemovalEvents, {
      dbClient: database,
      fetchMessageMetadataFn,
      now,
    });
  } catch (err) {
    console.warn(`[Gmail Sync] Provider-removal reconciliation failed for ${account.email}: ${syncErrorMessage(err)}`);
  }

  const statements: InStatement[] = emails.flatMap((email) =>
    triageStatementsForEmail(account.user_id, account.id, email, { arrivalGrace: true, now }),
  );
  statements.push(advanceCursorStatement({ historyId: lastHistoryId, account, now }));
  await database.batch(statements);
  if (emails.length) requestEmailTriageDrainAtFn(arrivalGraceDeadline(now));
  const snapshotQueuedAt = emails.length ? timingNow() : null;
  if (emails.length) {
    // P2-23: resolve the active snapshot once for the whole batch instead of
    // re-resolving it (3 queries) inside attach for every new email.
    const snapshot = await getOrCreateActiveSnapshot(account.user_id, { dbClient: database, now });
    for (const email of emails) {
      await attachArrivalGraceEmailToActiveSnapshot(account.user_id, account.id, email, {
        dbClient: database,
        now,
        snapshot,
      });
    }
  }

  const result = {
    account_id: account.id,
    start_history_id: startHistoryId,
    last_history_id: lastHistoryId,
    indexed: emails.length,
    queued: emails.length,
    read_state_reconciled: readStateReconciled,
    provider_removed: providerRemoved,
  };
  if (snapshotQueuedAt) {
    historySyncTimingByResult.set(result, { snapshotQueuedAt });
  }
  return result;
}

export async function enqueueEmailTriageForEmails(userId: string, emails: EmailTriageCandidate[], {
  dbClient = db,
  now = new Date(),
  arrivalGrace = true,
  requestEmailTriageDrainAtFn = requestEmailTriageDrainAt,
}: { dbClient?: Partial<EmailWriteDb>; now?: Date; arrivalGrace?: boolean; requestEmailTriageDrainAtFn?: (deadline: string) => unknown } = {}): Promise<{ queued: number }> {
  const database = dbClient as EmailWriteDb;
  const statements: InStatement[] = emails.flatMap((email) =>
    triageStatementsForEmail(userId, email.account_id, email, { arrivalGrace, now }),
  );
  if (statements.length) await database.batch(statements);
  if (arrivalGrace && emails.length) {
    requestEmailTriageDrainAtFn(arrivalGraceDeadline(now));
  }
  if (arrivalGrace && emails.length) {
    // P2-23: hoist active-snapshot resolution out of the per-email loop.
    const snapshot = await getOrCreateActiveSnapshot(userId, { dbClient: database, now });
    for (const email of emails) {
      await attachArrivalGraceEmailToActiveSnapshot(userId, email.account_id, email, {
        dbClient: database,
        now,
        snapshot,
      });
    }
  }
  return { queued: emails.length };
}

export async function renewDueGmailWatches({
  dbClient = db,
  now = new Date(),
  renewalLeadMs = WATCH_RENEWAL_LEAD_MS,
  topicName,
  topicResolver = async () => (await (await import("../platform/instance-credential-service.ts")).instanceCredentialService.resolve("gmail.pubsub_topic")).value,
}: { dbClient?: EmailWriteDb; now?: Date; renewalLeadMs?: number; topicName?: string; topicResolver?: () => Promise<string | null> } = {}) {
  topicName ??= await topicResolver() ?? undefined;
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
  for (const account of result.rows as unknown as GmailSyncAccount[]) {
    try {
      await registerGmailWatch(account, { dbClient, now, topicName });
      renewed++;
    } catch (err) {
      await markWatchError(account, syncErrorMessage(err), dbClient);
      console.error(`[Gmail Watch] Renewal failed for ${account.email}:`, syncErrorMessage(err));
    }
  }
  return { checked: result.rows.length, renewed, skipped: false };
}

async function loadGmailAccount(userId: string, accountId: string, dbClient: EmailWriteDb): Promise<GmailSyncAccount | null> {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_accounts
          WHERE user_id = ? AND id = ? AND type = 'gmail'
          LIMIT 1`,
    args: [userId, accountId],
  });
  return result.rows[0] as unknown as GmailSyncAccount || null;
}

async function claimNextHistorySyncJob(dbClient: EmailWriteDb, now: Date): Promise<GmailHistoryJobRow | null> {
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
  const job = result.rows[0] as unknown as GmailHistoryJobRow || null;
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

function parsePayloadJson(value: unknown): Record<string, unknown> {
  try {
    return JSON.parse(String(value || "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function processNextGmailHistorySyncJob({
  dbClient = db,
  now = new Date(),
  syncFn = syncGmailHistoryForAccount,
  timingNow = () => new Date(),
  logTimingFn = logTiming,
}: {
  dbClient?: Partial<EmailWriteDb> | null;
  now?: Date;
  syncFn?: (account: GmailSyncAccount, options: { dbClient: EmailWriteDb; targetHistoryId: string; now: Date; timingNow: () => Date }) => Promise<GmailHistorySyncSummary>;
  timingNow?: () => Date;
  logTimingFn?: (payload: Record<string, unknown>) => unknown;
} = {}) {
  const database = dbClient as EmailWriteDb;
  const job = await claimNextHistorySyncJob(database, now);
  if (!job) return { processed: false };
  const payload = parsePayloadJson(job.payload_json);
  const targetHistoryId = payload.historyId ? String(payload.historyId).trim() : "";

  const emitTiming = ({ status, completedAt, result = null, error = null, attempts = null }: { status: string; completedAt: Date; result?: GmailHistorySyncSummary | null; error?: GmailSyncError | null; attempts?: number | null }): void => {
    const providerStatus = Number(error?.status);
    const errorKind = error
      ? isInvalidGrantError(error.message)
        ? "invalid_grant"
        : Number.isFinite(providerStatus)
          ? "provider_http_error"
          : "sync_error"
      : undefined;
    try {
      logTimingFn({
        event: "email-arrival",
        jobId: Number(job.id),
        accountId: job.account_id,
        historyId: targetHistoryId || undefined,
        status,
        indexed: Number(result?.indexed || 0),
        queued: Number(result?.queued || 0),
        attempts,
        errorKind,
        providerStatus: Number.isFinite(providerStatus) ? providerStatus : undefined,
        ...projectEmailArrivalTiming({
          providerPublishedAt: payload.publishTime,
          historyQueuedAt: job.created_at,
          historyClaimedAt: now,
          snapshotQueuedAt: result?.snapshot_queued_at
            || (result ? historySyncTimingByResult.get(result)?.snapshotQueuedAt : undefined),
          completedAt,
        }),
      });
    } catch {
      // Timing evidence must never change queue completion or retry behavior.
    }
  };

  try {
    const account = await loadGmailAccount(job.user_id, job.account_id, database);
    if (!account) throw new Error(`Missing Gmail account ${job.account_id}`);
    // Defense in depth — a gmail_history_sync job whose payload lacks a historyId
    // can't advance the cursor and would force a 404-recovery backfill; skip it
    // instead of running.
    if (!targetHistoryId) {
      // Mirror triage-worker no-op convention: terminal 'complete' status so the claim
      // query never re-picks it, with skipped:true surfaced in the return value.
      await database.execute({
        sql: `UPDATE ea_triage_jobs
              SET status = 'complete',
                  completed_at = ?,
                  last_error = 'missing historyId in payload',
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [now.toISOString(), job.id],
      });
      emitTiming({ status: "skipped", completedAt: timingNow() });
      return { processed: true, job_id: Number(job.id), skipped: true };
    }
    const result = await syncFn(account, {
      dbClient: database,
      targetHistoryId,
      now,
      timingNow,
    });
    const completedAt = timingNow();
    await database.execute({
      sql: `UPDATE ea_triage_jobs
            SET status = 'complete',
                completed_at = ?,
                last_error = '',
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [now.toISOString(), job.id],
    });
    emitTiming({ status: "ok", completedAt, result });
    return { processed: true, job_id: Number(job.id), result };
  } catch (error) {
    const err = error as GmailSyncError;
    // CORR-L08: claimNextHistorySyncJob's UPDATE already bumped `attempts` in the
    // DB for this run (same claim-then-increment shape as the triage queue's
    // claimNextEmailTriageJob), but the in-memory `job` object here is the SELECT
    // snapshot taken BEFORE that UPDATE ran — job.attempts is the pre-claim value.
    // The current attempt count is therefore job.attempts + 1; do not re-increment
    // attempts ourselves (that's already been done by the claim), just use
    // job.attempts + 1 to decide terminal-vs-requeue and to compute backoff.
    const currentAttempts = Number(job.attempts || 0) + 1;
    let status;
    if (isInvalidGrantError(err.message)) {
      // Revoked/expired OAuth grant: retrying is pointless until the user
      // reconnects the account, so fail immediately instead of burning through
      // the retry budget, and flag the account for reconnect (Task 2/CORR-Lxx).
      await database.execute({
        sql: `UPDATE ea_triage_jobs
              SET status = 'failed',
                  last_error = ?,
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [syncErrorMessage(err), job.id],
      });
      try {
        await markAccountNeedsReauth(job.account_id, { dbClient: database as unknown as Client });
      } catch (markErr) {
        console.error("[GmailSync] Failed to mark account needs_reauth:", syncErrorMessage(markErr));
      }
      status = "failed";
    } else if (currentAttempts >= MAX_GMAIL_HISTORY_SYNC_ATTEMPTS) {
      await database.execute({
        sql: `UPDATE ea_triage_jobs
              SET status = 'failed',
                  last_error = ?,
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [syncErrorMessage(err), job.id],
      });
      status = "failed";
    } else {
      const scheduledFor = triageRetryBackoffIso(now, currentAttempts);
      await database.execute({
        sql: `UPDATE ea_triage_jobs
              SET status = 'queued',
                  scheduled_for = ?,
                  last_error = ?,
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [scheduledFor, syncErrorMessage(err), job.id],
      });
      status = "retrying";
    }
    emitTiming({
      status,
      completedAt: timingNow(),
      error: err,
      attempts: currentAttempts,
    });
    throw err;
  }
}
