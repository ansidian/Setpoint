import db from "../db/connection.ts";
import { decrypt } from "../platform/encryption.ts";
import { accountCredentialContext } from "../platform/credential-encryption-context.ts";
import {
  batchMarkAsRead as gmailBatchMarkAsRead,
  snoozeAtGmail,
  wakeAtGmail,
} from "./gmail.ts";
import {
  batchMarkAsRead as icloudBatchMarkAsRead,
} from "./icloud.ts";
import {
  deferPendingTriageForSnooze,
  markPendingTriageDismissed,
  markProviderRemovedFromActiveSnapshots,
  restorePendingTriageEligibilityForEmail,
  settleReadArrivalGraceRows,
} from "../snapshots/snapshot-service.ts";
import { loadUserConfig } from "../platform/config-service.ts";
import { canonicalizeConfiguredAccounts, normalizeEmailAddress } from "../platform/account-canonical.ts";
import {
  fetchEmailBodyForUid,
  fetchEmailAttachmentForUid,
  markEmailReadWithProvider,
  markEmailUnreadWithProvider,
  trashEmailWithProvider,
} from "./email-provider-adapters.ts";
import type {
  EmailBatchReadFailure,
  PinnedEmailSnapshot,
} from "../../shared/types/email.ts";
import type { ConfiguredEmailAccount, EmailHttpError } from "./email-provider-types.ts";

interface BatchReadOperation {
  provider: "gmail" | "icloud";
  uids: string[];
  run: () => Promise<void>;
}

type BatchReadError = EmailHttpError & {
  code: "email_mark_all_read_failed";
  failed: EmailBatchReadFailure[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Private helpers ---

async function markEmailsReadInIndex(userId: string, uids: string | string[]): Promise<void> {
  const list = Array.isArray(uids) ? uids : [uids];
  if (!list.length) return;
  const placeholders = list.map(() => "?").join(",");
  await db.execute({
    sql: `UPDATE ea_email_index SET read = 1 WHERE user_id = ? AND uid IN (${placeholders})`,
    args: [userId, ...list],
  });
}

async function markEmailsUnreadInIndex(userId: string, uids: string | string[]): Promise<void> {
  const list = Array.isArray(uids) ? uids : [uids];
  if (!list.length) return;
  const placeholders = list.map(() => "?").join(",");
  await db.execute({
    sql: `UPDATE ea_email_index SET read = 0 WHERE user_id = ? AND uid IN (${placeholders})`,
    args: [userId, ...list],
  });
}

function normalizeUidList(uids: string | string[]): string[] {
  const list = Array.isArray(uids) ? uids : [uids];
  return [...new Set(list.filter(Boolean))];
}

function buildBatchReadFailure({ message, failed, total }: { message?: string; failed: EmailBatchReadFailure[]; total: number }): BatchReadError {
  const err = new Error(message || `Failed to mark ${total} email${total === 1 ? "" : "s"} as read.`) as BatchReadError;
  err.status = 502;
  err.code = "email_mark_all_read_failed";
  err.failed = failed;
  return err;
}

// --- Read ops ---

export async function getEmailBody(userId: string, uid: string) {
  return fetchEmailBodyForUid(userId, uid);
}

export async function getEmailAttachment(userId: string, uid: string, attachmentId: string) {
  return fetchEmailAttachmentForUid(userId, uid, attachmentId);
}

export { searchEmails } from "./email-index-search.ts";

// --- State-changing ops ---

export async function markRead(userId: string, uid: string): Promise<void> {
  await markEmailReadWithProvider(userId, uid);
  await markEmailsReadInIndex(userId, uid);
}

export async function markUnread(userId: string, uid: string): Promise<void> {
  await markEmailUnreadWithProvider(userId, uid);
  await markEmailsUnreadInIndex(userId, uid);
}

export async function trash(userId: string, uid: string): Promise<void> {
  const adapter = await trashEmailWithProvider(userId, uid);
  // P3-74: the provider trash above has already committed. The two local
  // cleanups are best-effort follow-ups; a failure in either must NOT surface
  // as a request error implying the trash failed (and must not abort the
  // other cleanup). Use allSettled and log individual failures.
  const cleanups = await Promise.allSettled([
    db.execute({
      sql: "DELETE FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
      args: [userId, uid],
    }),
    markProviderRemovedFromActiveSnapshots(
      userId,
      adapter.providerAccountId,
      uid,
      "trashed",
    ),
  ]);
  const cleanupLabels = ["snooze-row-delete", "snapshot-provider-removal"];
  cleanups.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `[EA Trash] post-trash local cleanup failed (${cleanupLabels[index]}) for ${uid}:`,
        errorMessage(result.reason),
      );
    }
  });
}

export async function markAllRead(userId: string, uids: string | string[]): Promise<{ updatedUids: string[]; failed: EmailBatchReadFailure[] }> {
  const requestedUids = normalizeUidList(uids);
  if (!requestedUids.length) {
    return { updatedUids: [], failed: [] };
  }

  const gmailUids = new Map<string, { account: ConfiguredEmailAccount; uids: string[] }>();
  const icloudUids: string[] = [];
  const failed: EmailBatchReadFailure[] = [];

  const accounts = await db.execute({
    sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND (type = 'gmail' OR type = 'icloud')",
    args: [userId],
  });
  const rawGmailAccounts = accounts.rows
    .filter((account) => account.type === "gmail")
    .map((account) => ({ ...account, type: account.type || "gmail" })) as unknown as ConfiguredEmailAccount[];
  const canonicalGmailAccounts = canonicalizeConfiguredAccounts(rawGmailAccounts);
  const unresolvedGmailUids: string[] = [];

  for (const uid of requestedUids) {
    if (uid.startsWith("icloud-")) {
      icloudUids.push(uid);
    } else if (uid.startsWith("gmail-")) {
      const matchedPrefix = rawGmailAccounts.find((account) => uid.startsWith(`gmail-${account.id}-`)) || null;
      const matchedEmail = matchedPrefix?.email
        ? normalizeEmailAddress(matchedPrefix.email)
        : null;

      if (!matchedPrefix || !matchedEmail) {
        unresolvedGmailUids.push(uid);
        continue;
      }

      const canonical = canonicalGmailAccounts.find(
        (account) => normalizeEmailAddress(account.email) === matchedEmail,
      ) || matchedPrefix;
      const account = canonical.id === matchedPrefix.id
        ? canonical
        : { ...canonical, canonical_id: canonical.id, uid_account_id: matchedPrefix.id };
      const accountKey = account.canonical_id || account.id;
      if (!gmailUids.has(accountKey)) gmailUids.set(accountKey, { account, uids: [] });
      gmailUids.get(accountKey)!.uids.push(uid);
    } else {
      failed.push({
        provider: "unknown",
        uids: [uid],
        message: "Unsupported email UID format.",
      });
    }
  }

  if (unresolvedGmailUids.length) {
    const placeholders = unresolvedGmailUids.map(() => "?").join(",");
    const indexed = await db.execute({
      sql: `SELECT uid, account_id, account_email
            FROM ea_email_index
            WHERE user_id = ? AND uid IN (${placeholders})`,
      args: [userId, ...unresolvedGmailUids],
    });
    const indexedByUid = new Map(indexed.rows.map((row) => [String(row.uid), row]));

    for (const uid of unresolvedGmailUids) {
      const indexedRow = indexedByUid.get(uid);
      const indexedEmail = normalizeEmailAddress(indexedRow?.account_email);
      const canonical = indexedEmail
        ? canonicalGmailAccounts.find((account) => normalizeEmailAddress(account.email) === indexedEmail)
        : null;

      if (!canonical) {
        failed.push({
          provider: "gmail",
          uids: [uid],
          message: "Gmail account not found for one or more emails.",
        });
        continue;
      }

      const uidAccountId = String(indexedRow?.account_id || canonical.id);
      const account = uidAccountId === canonical.id
        ? canonical
        : { ...canonical, canonical_id: canonical.id, uid_account_id: uidAccountId };
      const accountKey = account.canonical_id || account.id;
      if (!gmailUids.has(accountKey)) gmailUids.set(accountKey, { account, uids: [] });
      gmailUids.get(accountKey)!.uids.push(uid);
    }
  }

  const ops: BatchReadOperation[] = [];
  for (const { account, uids: accUids } of gmailUids.values()) {
    ops.push({
      provider: "gmail",
      uids: accUids,
      run: () => gmailBatchMarkAsRead(account, accUids),
    });
  }
  if (icloudUids.length) {
    const placeholders = icloudUids.map(() => "?").join(",");
    const indexed = await db.execute({
      sql: `SELECT uid, account_id
            FROM ea_email_index
            WHERE user_id = ? AND uid IN (${placeholders})`,
      args: [userId, ...icloudUids],
    });
    const accountIdByUid = new Map(indexed.rows.map((row) => [String(row.uid), String(row.account_id)]));
    const groupedIcloud = new Map<string, { account: ConfiguredEmailAccount; uids: string[] }>();
    // Only fall back to a single unambiguous iCloud account; with multiple accounts
    // the bare UID can't identify the mailbox, so don't guess (avoids wrong-mailbox writes).
    const icloudAccounts = accounts.rows.filter((a) => a.type === "icloud") as unknown as ConfiguredEmailAccount[];
    const fallbackIcloud = icloudAccounts.length === 1 ? icloudAccounts[0] : null;

    for (const uid of icloudUids) {
      const accountId = accountIdByUid.get(uid) || fallbackIcloud?.id;
      const account = icloudAccounts.find((a) => a.id === accountId);
      if (!account) {
        failed.push({
          provider: "icloud",
          uids: [uid],
          message: "iCloud account not found for one or more emails.",
        });
        continue;
      }
      if (!groupedIcloud.has(account.id)) groupedIcloud.set(account.id, { account, uids: [] });
      groupedIcloud.get(account.id)!.uids.push(uid);
    }

    for (const { account, uids: accUids } of groupedIcloud.values()) {
      const password = decrypt(
        account.credentials_encrypted,
        accountCredentialContext(account.id),
      );
      ops.push({
        provider: "icloud",
        uids: accUids,
        run: () => icloudBatchMarkAsRead(account.email, password, accUids),
      });
    }
  }

  const settled = await Promise.allSettled(ops.map((op) => op.run()));
  const updatedUids: string[] = [];

  settled.forEach((result, index) => {
    const op = ops[index]!;
    if (result.status === "fulfilled") {
      updatedUids.push(...op.uids);
      return;
    }
    failed.push({
      provider: op.provider,
      uids: op.uids,
      message: result.reason instanceof Error ? result.reason.message : "Failed to mark emails as read.",
    });
  });

  if (updatedUids.length) {
    await markEmailsReadInIndex(userId, updatedUids);
  }

  if (failed.length && !updatedUids.length) {
    throw buildBatchReadFailure({
      message: failed[0]?.message,
      failed,
      total: requestedUids.length,
    });
  }

  return { updatedUids, failed };
}

export async function snooze(userId: string, uid: string, untilTs: number, snapshot: PinnedEmailSnapshot | null): Promise<void> {
  const snapshotJson = snapshot ? JSON.stringify(snapshot) : null;
  const accountId = snapshot?.account_id;

  // P3-60: the snooze-row write and the pending-triage defer must succeed or
  // fail together, and the external Gmail snooze-modify is the last (and only
  // non-rollbackable-by-DELETE) step. We do all local writes first, then call
  // Gmail. A defer failure rolls back the just-written snooze row; a Gmail
  // failure rolls back BOTH the defer and the snooze row. This guarantees we
  // never leave a committed snooze whose pending triage is still scheduled
  // (which would let the triage worker process content the user deferred).
  await db.execute({
    sql: `INSERT INTO ea_snoozed_emails (user_id, email_id, until_ts, email_snapshot)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, email_id) DO UPDATE
            SET until_ts = excluded.until_ts, email_snapshot = excluded.email_snapshot`,
    args: [userId, uid, untilTs, snapshotJson],
  });

  if (!accountId) return;

  async function rollbackSnoozeRow() {
    try {
      await db.execute({
        sql: "DELETE FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
        args: [userId, uid],
      });
    } catch (rollbackErr) {
      console.error("[EA Snooze] Rollback DELETE failed:", errorMessage(rollbackErr));
    }
  }

  try {
    await deferPendingTriageForSnooze(userId, accountId, uid, untilTs);
  } catch (deferErr) {
    console.error("[EA Snooze] Pending-triage defer failed, rolling back DB row:", errorMessage(deferErr));
    await rollbackSnoozeRow();
    throw deferErr;
  }

  const { accounts } = await loadUserConfig(userId);
  const acc = (accounts as unknown as ConfiguredEmailAccount[]).find(
    (a) => a.id === accountId || a.email === snapshot?.account_email,
  );
  if (acc?.type !== "gmail") return;

  try {
    await snoozeAtGmail(acc, uid);
  } catch (archiveErr) {
    console.error("[EA Snooze] Gmail snooze-modify failed, rolling back DB row and defer:", errorMessage(archiveErr));
    try {
      await restorePendingTriageEligibilityForEmail(userId, accountId, uid);
    } catch (restoreErr) {
      console.error("[EA Snooze] Rollback of pending-triage defer failed:", errorMessage(restoreErr));
    }
    await rollbackSnoozeRow();
    const err = new Error("Failed to snooze on Gmail") as EmailHttpError;
    err.status = 502;
    throw err;
  }
}

export async function wake(userId: string, uid: string): Promise<void> {
  const existing = await db.execute({
    sql: "SELECT email_snapshot FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
    args: [userId, uid],
  });
  let snap: PinnedEmailSnapshot | null = null;
  if (existing.rows[0]?.email_snapshot) {
    try {
      const parsed: unknown = JSON.parse(String(existing.rows[0].email_snapshot));
      snap = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as PinnedEmailSnapshot
        : null;
    } catch {
      /* ignore */
    }
  }

  await db.execute({
    sql: "DELETE FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
    args: [userId, uid],
  });

  if (snap?.account_id) {
    try {
      const { accounts } = await loadUserConfig(userId);
      const acc = (accounts as unknown as ConfiguredEmailAccount[]).find(
        (a) => a.id === snap.account_id || a.email === snap.account_email,
      );
      if (acc?.type === "gmail") await wakeAtGmail(acc, uid);
    } catch (unarchiveErr) {
      console.error("[EA Snooze] Gmail wake-modify failed:", errorMessage(unarchiveErr));
      // Non-fatal; DB state is correct.
    }
    await restorePendingTriageEligibilityForEmail(userId, snap.account_id, uid);
  }
}

export async function dismiss(userId: string, emailId: string): Promise<void> {
  await db.execute({
    sql: "INSERT OR IGNORE INTO ea_dismissed_emails (user_id, email_id) VALUES (?, ?)",
    args: [userId, emailId],
  });
  await markPendingTriageDismissed(userId, emailId);
}

export async function settleArrivalGrace(userId: string): Promise<{ settled: number; emailIds: string[] }> {
  return settleReadArrivalGraceRows(userId);
}

export { pin, unpin } from "./pinned-emails.ts";
export {
  listRemoteContentTrust,
  removeRemoteContentTrust,
  trustRemoteContentSender,
} from "./remote-content-trust.ts";
