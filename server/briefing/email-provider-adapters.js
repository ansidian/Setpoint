import db from "../db/connection.js";
import { decrypt } from "./encryption.js";
import {
  fetchEmailBody as fetchGmailBody,
  markAsRead as gmailMarkAsRead,
  markAsUnread as gmailMarkAsUnread,
  trashMessage as gmailTrash,
} from "./gmail.js";
import {
  fetchEmailBody as fetchIcloudBody,
  markAsRead as icloudMarkAsRead,
  markAsUnread as icloudMarkAsUnread,
  trashMessage as icloudTrash,
} from "./icloud.js";
import { canonicalizeConfiguredAccounts, normalizeEmailAddress } from "./account-canonical.js";

export async function findAccountByUid(userId, uid) {
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

function unknownUidError(uid) {
  if (uid?.startsWith("gmail-")) {
    const err = new Error("Gmail account not found");
    err.status = 404;
    return err;
  }
  if (uid?.startsWith("icloud-")) {
    const err = new Error("No iCloud account found");
    err.status = 404;
    return err;
  }
  const err = new Error("Unknown email uid format");
  err.status = 400;
  return err;
}

function missingAccountError() {
  const err = new Error("Account not found");
  err.status = 404;
  return err;
}

async function resolveProviderAdapter(userId, uid, { notFoundError = missingAccountError } = {}) {
  const found = await findAccountByUid(userId, uid);
  if (!found?.account) throw notFoundError(uid);
  if (found.type === "icloud") {
    const password = decrypt(found.account.credentials_encrypted);
    return {
      type: "icloud",
      account: found.account,
      providerAccountId: found.account.id,
      fetchBody: () => fetchIcloudBody(found.account.email, password, uid),
      markRead: () => icloudMarkAsRead(found.account.email, password, uid),
      markUnread: () => icloudMarkAsUnread(found.account.email, password, uid),
      trash: () => icloudTrash(found.account.email, password, uid),
    };
  }
  return {
    type: "gmail",
    account: found.account,
    providerAccountId: found.account.uid_account_id || found.account.id,
    fetchBody: () => fetchGmailBody(found.account, uid),
    markRead: () => gmailMarkAsRead(found.account, uid),
    markUnread: () => gmailMarkAsUnread(found.account, uid),
    trash: () => gmailTrash(found.account, uid),
  };
}

export async function fetchEmailBodyForUid(userId, uid) {
  const adapter = await resolveProviderAdapter(userId, uid, { notFoundError: unknownUidError });
  return adapter.fetchBody();
}

export async function markEmailReadWithProvider(userId, uid) {
  const adapter = await resolveProviderAdapter(userId, uid);
  await adapter.markRead();
  return adapter;
}

export async function markEmailUnreadWithProvider(userId, uid) {
  const adapter = await resolveProviderAdapter(userId, uid);
  await adapter.markUnread();
  return adapter;
}

export async function trashEmailWithProvider(userId, uid) {
  const adapter = await resolveProviderAdapter(userId, uid);
  await adapter.trash();
  return adapter;
}
