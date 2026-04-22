import db from "../db/connection.js";
import { decrypt } from "./encryption.js";
import {
  fetchEmailBody as fetchGmailBody,
  markAsRead as gmailMarkAsRead,
  markAsUnread as gmailMarkAsUnread,
  trashMessage as gmailTrash,
  batchMarkAsRead as gmailBatchMarkAsRead,
  snoozeAtGmail,
  wakeAtGmail,
} from "./gmail.js";
import {
  fetchEmailBody as fetchIcloudBody,
  markAsRead as icloudMarkAsRead,
  markAsUnread as icloudMarkAsUnread,
  trashMessage as icloudTrash,
  batchMarkAsRead as icloudBatchMarkAsRead,
} from "./icloud.js";
import * as storedBriefingService from "./stored-briefing-service.js";
import { loadUserConfig } from "./index.js";
import { canonicalizeConfiguredAccounts, normalizeEmailAddress } from "./account-canonical.js";

// --- Private helpers ---

async function findAccountByUid(userId, uid) {
  if (uid.startsWith("icloud-")) {
    const indexed = await db.execute({
      sql: `SELECT a.*
            FROM ea_email_index idx
            JOIN ea_accounts a ON a.id = idx.account_id
            WHERE idx.user_id = ? AND idx.uid = ? AND a.user_id = ?
            LIMIT 1`,
      args: [userId, uid, userId],
    });
    if (indexed.rows.length) {
      return { type: "icloud", account: indexed.rows[0] };
    }
    const result = await db.execute({
      sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND type = 'icloud'",
      args: [userId],
    });
    if (!result.rows.length) return null;
    return { type: "icloud", account: result.rows[0] };
  }
  if (uid.startsWith("gmail-")) {
    const result = await db.execute({
      sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND type = 'gmail'",
      args: [userId],
    });
    const rawAccounts = result.rows.map((account) => ({ ...account, type: account.type || "gmail" }));
    const canonicalAccounts = canonicalizeConfiguredAccounts(rawAccounts);
    const matchedPrefix = rawAccounts.find((account) => uid.startsWith(`gmail-${account.id}-`)) || null;
    const matchedEmail = matchedPrefix?.email
      ? normalizeEmailAddress(matchedPrefix.email)
      : null;

    if (matchedPrefix && matchedEmail) {
      const canonical = canonicalAccounts.find(
        (account) => normalizeEmailAddress(account.email) === matchedEmail,
      ) || matchedPrefix;
      return {
        type: "gmail",
        account: canonical.id === matchedPrefix.id
          ? canonical
          : { ...canonical, canonical_id: canonical.id, uid_account_id: matchedPrefix.id },
      };
    }

    const indexed = await db.execute({
      sql: `SELECT account_id, account_email
            FROM ea_email_index
            WHERE user_id = ? AND uid = ?
            LIMIT 1`,
      args: [userId, uid],
    });
    const indexedEmail = normalizeEmailAddress(indexed.rows[0]?.account_email);
    if (!indexedEmail) return null;
    const canonical = canonicalAccounts.find(
      (account) => normalizeEmailAddress(account.email) === indexedEmail,
    );
    if (!canonical) return null;
    const uidAccountId = indexed.rows[0]?.account_id || canonical.id;
    return {
      type: "gmail",
      account: uidAccountId === canonical.id
        ? canonical
        : { ...canonical, canonical_id: canonical.id, uid_account_id: uidAccountId },
    };
  }
  return null;
}

function buildEmailWebUrl(uid, accountId, accountEmail) {
  if (!uid?.startsWith("gmail-")) return null;
  const prefix = `gmail-${accountId}-`;
  if (!uid.startsWith(prefix)) return null;
  const messageId = uid.slice(prefix.length);
  if (!messageId) return null;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${messageId}`;
}

function sanitizeFtsQuery(raw) {
  const terms = raw
    .replace(/[\u201C\u201D]/g, '"')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (terms.length > 0) {
    const last = terms[terms.length - 1];
    terms[terms.length - 1] = last.slice(0, -1) + '"*';
  }
  return terms.join(" ") || `"${raw}"`;
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
  if (uid.startsWith("icloud-")) {
    const accounts = await db.execute({
      sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND type = 'icloud'",
      args: [userId],
    });
    if (!accounts.rows.length) {
      const err = new Error("No iCloud account found");
      err.status = 404;
      throw err;
    }
    const account = accounts.rows[0];
    const password = decrypt(account.credentials_encrypted);
    return fetchIcloudBody(account.email, password, uid);
  }
  if (uid.startsWith("gmail-")) {
    const found = await findAccountByUid(userId, uid);
    if (!found?.account) {
      const err = new Error("Gmail account not found");
      err.status = 404;
      throw err;
    }
    return fetchGmailBody(found.account, uid);
  }
  const err = new Error("Unknown email uid format");
  err.status = 400;
  throw err;
}

export async function searchEmails(userId, { q, limit }) {
  const maxResults = Math.min(parseInt(limit) || 30, 100);
  const fetchLimit = Math.max(maxResults * 3, 90);
  const result = await db.execute({
    sql: `SELECT
            idx.uid, idx.account_id, idx.account_label, idx.account_email,
            idx.account_color, idx.account_icon,
            idx.from_name, idx.from_address, idx.subject, idx.body_snippet,
            idx.email_date, idx.read,
            snippet(ea_email_fts, 3, '<mark>', '</mark>', '...', 32) AS subject_highlight,
            snippet(ea_email_fts, 5, '<mark>', '</mark>', '...', 48) AS body_highlight,
            rank
          FROM ea_email_fts
          JOIN ea_email_index idx ON idx.uid = ea_email_fts.uid
          WHERE ea_email_fts MATCH ? AND idx.user_id = ?
          ORDER BY rank
          LIMIT ?`,
    args: [sanitizeFtsQuery(q.trim()), userId, fetchLimit],
  });

  const nowMs = Date.now();
  const RECENCY_HALF_LIFE_DAYS = 30;
  const scored = result.rows.map((row) => {
    const t = row.email_date ? Date.parse(row.email_date) : NaN;
    const ageDays = Number.isFinite(t) ? Math.max(0, (nowMs - t) / 86400000) : 0;
    const hybrid = row.rank / (1 + ageDays / RECENCY_HALF_LIFE_DAYS);
    return { row, hybrid };
  });
  scored.sort((a, b) => a.hybrid - b.hybrid);
  const ranked = scored.slice(0, maxResults).map((s) => s.row);

  const byAccount = {};
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
    byAccount[key].results.push({
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
    });
  }

  return { accounts: Object.values(byAccount), total: ranked.length, query: q };
}

// --- State-changing ops ---

export async function markRead(userId, uid) {
  const found = await findAccountByUid(userId, uid);
  if (!found) {
    const err = new Error("Account not found");
    err.status = 404;
    throw err;
  }
  if (found.type === "icloud") {
    const password = decrypt(found.account.credentials_encrypted);
    await icloudMarkAsRead(found.account.email, password, uid);
  } else {
    await gmailMarkAsRead(found.account, uid);
  }
  await storedBriefingService.markEmailsRead(userId, uid);
  await markEmailsReadInIndex(userId, uid);
}

export async function markUnread(userId, uid) {
  const found = await findAccountByUid(userId, uid);
  if (!found) {
    const err = new Error("Account not found");
    err.status = 404;
    throw err;
  }
  if (found.type === "icloud") {
    const password = decrypt(found.account.credentials_encrypted);
    await icloudMarkAsUnread(found.account.email, password, uid);
  } else {
    await gmailMarkAsUnread(found.account, uid);
  }
  await storedBriefingService.markEmailsUnread(userId, uid);
  await markEmailsUnreadInIndex(userId, uid);
}

export async function trash(userId, uid) {
  const found = await findAccountByUid(userId, uid);
  if (!found) {
    const err = new Error("Account not found");
    err.status = 404;
    throw err;
  }
  if (found.type === "icloud") {
    const password = decrypt(found.account.credentials_encrypted);
    await icloudTrash(found.account.email, password, uid);
  } else {
    await gmailTrash(found.account, uid);
  }
  await Promise.all([
    db.execute({
      sql: "DELETE FROM ea_pinned_emails WHERE user_id = ? AND email_id = ?",
      args: [userId, uid],
    }),
    db.execute({
      sql: "DELETE FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
      args: [userId, uid],
    }),
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

  for (const uid of requestedUids) {
    if (uid.startsWith("icloud-")) {
      icloudUids.push(uid);
    } else if (uid.startsWith("gmail-")) {
      const account = accounts.rows.find(
        (a) => a.type === "gmail" && uid.startsWith(`gmail-${a.id}-`),
      );
      if (account) {
        if (!gmailUids.has(account.id)) gmailUids.set(account.id, { account, uids: [] });
        gmailUids.get(account.id).uids.push(uid);
      } else {
        failed.push({
          provider: "gmail",
          uids: [uid],
          message: "Gmail account not found for one or more emails.",
        });
      }
    } else {
      failed.push({
        provider: "unknown",
        uids: [uid],
        message: "Unsupported email UID format.",
      });
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
    await storedBriefingService.markEmailsRead(userId, updatedUids);
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
  }
}

export async function pin(userId, emailId, snapshot) {
  const snapshotJson = snapshot ? JSON.stringify(snapshot) : null;
  await db.execute({
    sql: `INSERT INTO ea_pinned_emails (user_id, email_id, email_snapshot)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, email_id) DO UPDATE SET email_snapshot = excluded.email_snapshot`,
    args: [userId, emailId, snapshotJson],
  });
}

export async function unpin(userId, emailId) {
  await db.execute({
    sql: "DELETE FROM ea_pinned_emails WHERE user_id = ? AND email_id = ?",
    args: [userId, emailId],
  });
}

export async function dismiss(userId, emailId) {
  await db.execute({
    sql: "INSERT OR IGNORE INTO ea_dismissed_emails (user_id, email_id) VALUES (?, ?)",
    args: [userId, emailId],
  });
  await storedBriefingService.removeDismissedEmailFromBriefing(userId, emailId);
}

// Exposed for unit testing only
export const __testing__ = {
  findAccountByUid,
  buildEmailWebUrl,
  sanitizeFtsQuery,
};
