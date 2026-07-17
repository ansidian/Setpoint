import db from "../db/connection.ts";
import { decrypt } from "../platform/encryption.ts";
import {
  fetchEmailBody as fetchGmailBody,
  markAsRead as gmailMarkAsRead,
  markAsUnread as gmailMarkAsUnread,
  trashMessage as gmailTrash,
} from "./gmail.ts";
import {
  fetchEmailBody as fetchIcloudBody,
  markAsRead as icloudMarkAsRead,
  markAsUnread as icloudMarkAsUnread,
  trashMessage as icloudTrash,
} from "./icloud.ts";
import { canonicalizeConfiguredAccounts, normalizeEmailAddress } from "../platform/account-canonical.ts";
import type { EmailBody } from "../../shared/types/email.ts";
import type {
  ConfiguredEmailAccount,
  EmailHttpError,
  EmailProviderAdapter,
} from "./email-provider-types.ts";

type FoundEmailAccount =
  | { type: "icloud"; account: ConfiguredEmailAccount }
  | { type: "gmail"; account: ConfiguredEmailAccount };
type NotFoundErrorFactory = (uid: string) => EmailHttpError;

export async function findAccountByUid(userId: string, uid: string): Promise<FoundEmailAccount | null> {
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
      return { type: "icloud", account: indexed.rows[0] as unknown as ConfiguredEmailAccount };
    }
    const result = await db.execute({
      sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND type = 'icloud'",
      args: [userId],
    });
    if (!result.rows.length) return null;
    // Only resolve the bare-UID fallback when it is unambiguous (a single iCloud
    // account). With multiple accounts the UID carries no account identity, so
    // guessing rows[0] would route mark-read/trash to the WRONG mailbox.
    if (result.rows.length > 1) {
      throw Object.assign(new Error(`Cannot resolve iCloud account for uid ${uid}`), { status: 404 });
    }
    return { type: "icloud", account: result.rows[0] as unknown as ConfiguredEmailAccount };
  }
  if (uid.startsWith("gmail-")) {
    const result = await db.execute({
      sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND type = 'gmail'",
      args: [userId],
    });
    const rawAccounts = result.rows.map((account) => ({
      ...account,
      type: account.type || "gmail",
    })) as unknown as ConfiguredEmailAccount[];
    const canonicalAccounts = canonicalizeConfiguredAccounts(rawAccounts) as unknown as ConfiguredEmailAccount[];
    const matchedPrefix = rawAccounts.find((account) => uid.startsWith(`gmail-${account.id}-`)) || null;
    const matchedEmail = matchedPrefix?.email
      ? normalizeEmailAddress(String(matchedPrefix.email))
      : null;

    if (matchedPrefix && matchedEmail) {
      const canonical = canonicalAccounts.find(
        (account) => normalizeEmailAddress(String(account.email)) === matchedEmail,
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
    const indexedEmail = normalizeEmailAddress(String(indexed.rows[0]?.account_email || ""));
    if (!indexedEmail) return null;
    const canonical = canonicalAccounts.find(
      (account) => normalizeEmailAddress(String(account.email)) === indexedEmail,
    );
    if (!canonical) return null;
    const uidAccountId = String(indexed.rows[0]?.account_id || canonical.id);
    return {
      type: "gmail",
      account: uidAccountId === canonical.id
        ? canonical
        : { ...canonical, canonical_id: canonical.id, uid_account_id: uidAccountId },
    };
  }
  return null;
}

function unknownUidError(uid: string): EmailHttpError {
  if (uid?.startsWith("gmail-")) {
    const err = new Error("Gmail account not found") as EmailHttpError;
    err.status = 404;
    return err;
  }
  if (uid?.startsWith("icloud-")) {
    const err = new Error("No iCloud account found") as EmailHttpError;
    err.status = 404;
    return err;
  }
  const err = new Error("Unknown email uid format") as EmailHttpError;
  err.status = 400;
  return err;
}

function missingAccountError(_uid: string): EmailHttpError {
  const err = new Error("Account not found") as EmailHttpError;
  err.status = 404;
  return err;
}

async function resolveProviderAdapter(
  userId: string,
  uid: string,
  { notFoundError = missingAccountError }: { notFoundError?: NotFoundErrorFactory } = {},
): Promise<EmailProviderAdapter> {
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

export async function fetchEmailBodyForUid(userId: string, uid: string): Promise<EmailBody> {
  const adapter = await resolveProviderAdapter(userId, uid, { notFoundError: unknownUidError });
  return adapter.fetchBody();
}

export async function markEmailReadWithProvider(userId: string, uid: string): Promise<EmailProviderAdapter> {
  const adapter = await resolveProviderAdapter(userId, uid);
  await adapter.markRead();
  return adapter;
}

export async function markEmailUnreadWithProvider(userId: string, uid: string): Promise<EmailProviderAdapter> {
  const adapter = await resolveProviderAdapter(userId, uid);
  await adapter.markUnread();
  return adapter;
}

export async function trashEmailWithProvider(userId: string, uid: string): Promise<EmailProviderAdapter> {
  const adapter = await resolveProviderAdapter(userId, uid);
  await adapter.trash();
  return adapter;
}
