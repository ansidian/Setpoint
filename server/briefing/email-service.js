import db from "../db/connection.js";
import { decrypt } from "./encryption.js";
import {
  batchMarkAsRead as gmailBatchMarkAsRead,
  snoozeAtGmail,
  wakeAtGmail,
} from "./gmail.js";
import {
  batchMarkAsRead as icloudBatchMarkAsRead,
} from "./icloud.js";
import {
  deferPendingTriageForSnooze,
  markPendingTriageDismissed,
  markProviderRemovedFromActiveSnapshots,
  restorePendingTriageEligibilityForEmail,
  settleReadArrivalGraceRows,
} from "./snapshot-service.js";
import { loadUserConfig } from "./config-service.js";
import { canonicalizeConfiguredAccounts, normalizeEmailAddress } from "./account-canonical.js";
import {
  fetchEmailBodyForUid,
  findAccountByUid,
  markEmailReadWithProvider,
  markEmailUnreadWithProvider,
  trashEmailWithProvider,
} from "./email-provider-adapters.js";
import { parseEmailSearchQuery, sanitizeFtsQuery } from "./email-search-query.js";
import { rankEmailSearchRows } from "./email-search-ranking.js";
import { normalizeBillCandidate } from "./snapshot-lifecycle.js";

// --- Private helpers ---

function buildEmailWebUrl(uid, accountId, accountEmail) {
  if (!uid?.startsWith("gmail-")) return null;
  const prefix = `gmail-${accountId}-`;
  if (!uid.startsWith(prefix)) return null;
  const messageId = uid.slice(prefix.length);
  if (!messageId) return null;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${messageId}`;
}

function parseJsonPayload(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function markEmailsReadInIndex(userId, uids) {
  const list = Array.isArray(uids) ? uids : [uids];
  if (!list.length) return;
  const placeholders = list.map(() => "?").join(",");
  await db.execute({
    sql: `UPDATE ea_email_index SET read = 1 WHERE user_id = ? AND uid IN (${placeholders})`,
    args: [userId, ...list],
  });
}

async function markEmailsUnreadInIndex(userId, uids) {
  const list = Array.isArray(uids) ? uids : [uids];
  if (!list.length) return;
  const placeholders = list.map(() => "?").join(",");
  await db.execute({
    sql: `UPDATE ea_email_index SET read = 0 WHERE user_id = ? AND uid IN (${placeholders})`,
    args: [userId, ...list],
  });
}

function normalizeUidList(uids) {
  const list = Array.isArray(uids) ? uids : [uids];
  return [...new Set(list.filter(Boolean))];
}

function buildBatchReadFailure({ message, failed, total }) {
  const err = new Error(message || `Failed to mark ${total} email${total === 1 ? "" : "s"} as read.`);
  err.status = 502;
  err.code = "email_mark_all_read_failed";
  err.failed = failed;
  return err;
}

// --- Read ops ---

export async function getEmailBody(userId, uid) {
  return fetchEmailBodyForUid(userId, uid);
}

export async function searchEmails(userId, { q, limit, debug = false }) {
  const maxResults = Math.min(parseInt(limit) || 30, 100);
  const fetchLimit = Math.min(Math.max(maxResults * 8, 200), 500);
  const { textQuery, readFilter } = parseEmailSearchQuery(q);
  const hasTextQuery = textQuery.trim().length > 0;
  const readPredicate = readFilter == null ? "" : " AND idx.read = ?";
  const snapshotJoin = `
              LEFT JOIN ea_email_triage triage
                ON triage.user_id = idx.user_id
               AND triage.account_id = idx.account_id
               AND triage.email_id = idx.uid
              LEFT JOIN ea_briefing_snapshot_items snap
                ON snap.id = (
                  SELECT si.id
                  FROM ea_briefing_snapshot_items si
                  JOIN ea_briefing_snapshots s ON s.id = si.snapshot_id
                  WHERE si.user_id = idx.user_id
                    AND si.account_id = idx.account_id
                    AND si.email_id = idx.uid
                    AND s.status = 'active'
                  ORDER BY si.updated_at DESC, si.id DESC
                  LIMIT 1
                )`;
  const rankingColumns = `,
                triage.lane AS triage_lane,
                triage.category AS triage_category,
                triage.urgency AS triage_urgency,
                triage.deadline_at AS triage_deadline_at,
                triage.escalation_badge AS triage_escalation_badge,
                triage.bill_candidate_json AS triage_bill_candidate_json,
                triage.handled_at AS triage_handled_at,
                triage.provider_state AS triage_provider_state,
                triage.updated_at AS triage_updated_at,
                snap.lane_at_snapshot AS snapshot_lane,
                snap.category_at_snapshot AS snapshot_category,
                snap.urgency_at_snapshot AS snapshot_urgency,
                snap.deadline_at_snapshot AS snapshot_deadline_at,
                snap.escalation_badge_at_snapshot AS snapshot_escalation_badge,
                snap.dismissed_from_today_at AS snapshot_dismissed_from_today_at,
                snap.handled_at AS snapshot_handled_at,
                snap.provider_removed_at AS snapshot_provider_removed_at,
                snap.source_at AS snapshot_source_at,
                snap.resurfaced_at AS snapshot_resurfaced_at,
                snap.updated_at AS snapshot_updated_at`;
  const result = hasTextQuery
    ? await db.execute({
        sql: `SELECT
                idx.uid, idx.account_id, idx.account_label, idx.account_email,
                idx.account_color, idx.account_icon,
                idx.from_name, idx.from_address, idx.subject, idx.body_snippet,
                idx.email_date, idx.email_date_utc, idx.read,
                snippet(ea_email_fts, 3, '<mark>', '</mark>', '...', 32) AS subject_highlight,
                snippet(ea_email_fts, 5, '<mark>', '</mark>', '...', 48) AS body_highlight,
                rank
                ${rankingColumns}
              FROM ea_email_fts
              JOIN ea_email_index idx ON idx.uid = ea_email_fts.uid
              ${snapshotJoin}
              WHERE ea_email_fts MATCH ? AND idx.user_id = ?${readPredicate}
              ORDER BY rank
              LIMIT ?`,
        args: readFilter == null
          ? [sanitizeFtsQuery(textQuery), userId, fetchLimit]
          : [sanitizeFtsQuery(textQuery), userId, readFilter, fetchLimit],
      })
    : await db.execute({
        sql: `SELECT
                idx.uid, idx.account_id, idx.account_label, idx.account_email,
                idx.account_color, idx.account_icon,
                idx.from_name, idx.from_address, idx.subject, idx.body_snippet,
                idx.email_date, idx.email_date_utc, idx.read,
                NULL AS subject_highlight,
                NULL AS body_highlight,
                0 AS rank
                ${rankingColumns}
              FROM ea_email_index idx
              ${snapshotJoin}
              WHERE idx.user_id = ?${readPredicate}
              ORDER BY idx.email_date_utc DESC, idx.email_date DESC
              LIMIT ?`,
        args: readFilter == null
          ? [userId, fetchLimit]
          : [userId, readFilter, fetchLimit],
      });

  const ranked = rankEmailSearchRows(result.rows, {
    query: textQuery,
    limit: maxResults,
    debug,
  });

  const byAccount = {};
  const results = [];
  const buildResult = (row) => {
    const billCandidate = parseJsonPayload(row.triage_bill_candidate_json);
    const email = {
      uid: row.uid,
      from_name: row.from_name,
      from_address: row.from_address,
      subject: row.subject,
      body_snippet: row.body_snippet,
      subject_highlight: row.subject_highlight,
      body_highlight: row.body_highlight,
      email_date: row.email_date,
      read: !!row.read,
      web_url: buildEmailWebUrl(row.uid, row.account_id, row.account_email),
      account_id: row.account_id,
      account_label: row.account_label,
      account_email: row.account_email,
      account_color: row.account_color,
      account_icon: row.account_icon,
    };
    if (billCandidate) {
      email.hasBill = true;
      email.bill_candidate = billCandidate;
      email.extractedBill = normalizeBillCandidate(billCandidate);
    }
    if (debug) {
      email.search_score = row.search_score;
      email.search_score_details = row.search_score_details;
    }
    return email;
  };

  for (const row of ranked) {
    const key = row.account_id;
    if (!byAccount[key]) {
      byAccount[key] = {
        account_id: row.account_id,
        account_label: row.account_label,
        account_email: row.account_email,
        account_color: row.account_color,
        account_icon: row.account_icon,
        results: [],
      };
    }
    const email = buildResult(row);
    results.push(email);
    byAccount[key].results.push(email);
  }

  return { results, accounts: Object.values(byAccount), total: ranked.length, query: q };
}

// --- State-changing ops ---

export async function markRead(userId, uid) {
  await markEmailReadWithProvider(userId, uid);
  await markEmailsReadInIndex(userId, uid);
}

export async function markUnread(userId, uid) {
  await markEmailUnreadWithProvider(userId, uid);
  await markEmailsUnreadInIndex(userId, uid);
}

export async function trash(userId, uid) {
  const adapter = await trashEmailWithProvider(userId, uid);
  await Promise.all([
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
}

export async function markAllRead(userId, uids) {
  const requestedUids = normalizeUidList(uids);
  if (!requestedUids.length) {
    return { updatedUids: [], failed: [] };
  }

  const gmailUids = new Map();
  const icloudUids = [];
  const failed = [];

  const accounts = await db.execute({
    sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND (type = 'gmail' OR type = 'icloud')",
    args: [userId],
  });
  const rawGmailAccounts = accounts.rows
    .filter((account) => account.type === "gmail")
    .map((account) => ({ ...account, type: account.type || "gmail" }));
  const canonicalGmailAccounts = canonicalizeConfiguredAccounts(rawGmailAccounts);
  const unresolvedGmailUids = [];

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
      gmailUids.get(accountKey).uids.push(uid);
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
    const indexedByUid = new Map(indexed.rows.map((row) => [row.uid, row]));

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

      const uidAccountId = indexedRow?.account_id || canonical.id;
      const account = uidAccountId === canonical.id
        ? canonical
        : { ...canonical, canonical_id: canonical.id, uid_account_id: uidAccountId };
      const accountKey = account.canonical_id || account.id;
      if (!gmailUids.has(accountKey)) gmailUids.set(accountKey, { account, uids: [] });
      gmailUids.get(accountKey).uids.push(uid);
    }
  }

  const ops = [];
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
    const accountIdByUid = new Map(indexed.rows.map((row) => [row.uid, row.account_id]));
    const groupedIcloud = new Map();
    const fallbackIcloud = accounts.rows.find((a) => a.type === "icloud");

    for (const uid of icloudUids) {
      const accountId = accountIdByUid.get(uid) || fallbackIcloud?.id;
      const account = accounts.rows.find((a) => a.type === "icloud" && a.id === accountId);
      if (!account) {
        failed.push({
          provider: "icloud",
          uids: [uid],
          message: "iCloud account not found for one or more emails.",
        });
        continue;
      }
      if (!groupedIcloud.has(account.id)) groupedIcloud.set(account.id, { account, uids: [] });
      groupedIcloud.get(account.id).uids.push(uid);
    }

    for (const { account, uids: accUids } of groupedIcloud.values()) {
      const password = decrypt(account.credentials_encrypted);
      ops.push({
        provider: "icloud",
        uids: accUids,
        run: () => icloudBatchMarkAsRead(account.email, password, accUids),
      });
    }
  }

  const settled = await Promise.allSettled(ops.map((op) => op.run()));
  const updatedUids = [];

  settled.forEach((result, index) => {
    const op = ops[index];
    if (result.status === "fulfilled") {
      updatedUids.push(...op.uids);
      return;
    }
    failed.push({
      provider: op.provider,
      uids: op.uids,
      message: result.reason?.message || "Failed to mark emails as read.",
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

export async function snooze(userId, uid, untilTs, snapshot) {
  const snapshotJson = snapshot ? JSON.stringify(snapshot) : null;
  await db.execute({
    sql: `INSERT INTO ea_snoozed_emails (user_id, email_id, until_ts, email_snapshot)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, email_id) DO UPDATE
            SET until_ts = excluded.until_ts, email_snapshot = excluded.email_snapshot`,
    args: [userId, uid, untilTs, snapshotJson],
  });

  const accountId = snapshot?.account_id;
  if (accountId) {
    try {
      const { accounts } = await loadUserConfig(userId);
      const acc = accounts.find(
        (a) => a.id === accountId || a.email === snapshot?.account_email,
      );
      if (acc?.type === "gmail") {
        await snoozeAtGmail(acc, uid);
      }
    } catch (archiveErr) {
      console.error("[EA Snooze] Gmail snooze-modify failed, rolling back DB row:", archiveErr.message);
      try {
        await db.execute({
          sql: "DELETE FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
          args: [userId, uid],
        });
      } catch (rollbackErr) {
        console.error("[EA Snooze] Rollback DELETE failed:", rollbackErr.message);
      }
      const err = new Error("Failed to snooze on Gmail");
      err.status = 502;
      throw err;
    }
    await deferPendingTriageForSnooze(userId, accountId, uid, untilTs);
  }
}

export async function wake(userId, uid) {
  const existing = await db.execute({
    sql: "SELECT email_snapshot FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
    args: [userId, uid],
  });
  let snap = null;
  if (existing.rows[0]?.email_snapshot) {
    try {
      snap = JSON.parse(existing.rows[0].email_snapshot);
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
      const acc = accounts.find(
        (a) => a.id === snap.account_id || a.email === snap.account_email,
      );
      if (acc?.type === "gmail") await wakeAtGmail(acc, uid);
    } catch (unarchiveErr) {
      console.error("[EA Snooze] Gmail wake-modify failed:", unarchiveErr.message);
      // Non-fatal; DB state is correct.
    }
    await restorePendingTriageEligibilityForEmail(userId, snap.account_id, uid);
  }
}

export async function dismiss(userId, emailId) {
  await db.execute({
    sql: "INSERT OR IGNORE INTO ea_dismissed_emails (user_id, email_id) VALUES (?, ?)",
    args: [userId, emailId],
  });
  await markPendingTriageDismissed(userId, emailId);
}

export async function settleArrivalGrace(userId) {
  return settleReadArrivalGraceRows(userId);
}

// Exposed for unit testing only
export const __testing__ = {
  findAccountByUid,
  buildEmailWebUrl,
  sanitizeFtsQuery,
  parseEmailSearchQuery,
};
