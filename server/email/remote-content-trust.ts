import db from "../db/connection.ts";
import type { RemoteContentTrustEntry } from "../../shared/types/email.ts";
import type { EmailReadDb, EmailWriteDb } from "./email-persistence-types.ts";

const MAX_SENDER_ADDRESS_LENGTH = 320;

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export function normalizeRemoteContentSenderAddress(value: unknown): string | null {
  const address = String(value || "").trim().toLowerCase();
  if (!address || address.length > MAX_SENDER_ADDRESS_LENGTH) return null;
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return null;
  return address;
}

export async function listRemoteContentTrust(
  userId: string,
  { dbClient = db }: { dbClient?: EmailReadDb } = {},
): Promise<RemoteContentTrustEntry[]> {
  const result = await dbClient.execute({
    sql: `SELECT trust.id,
                 trust.account_id,
                 account.label AS account_label,
                 account.email AS account_email,
                 trust.sender_address,
                 trust.created_at
          FROM ea_email_remote_content_trust trust
          JOIN ea_accounts account
            ON account.id = trust.account_id
           AND account.user_id = trust.user_id
          WHERE trust.user_id = ?
          ORDER BY trust.created_at DESC, trust.id DESC`,
    args: [userId],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    account_id: String(row.account_id || ""),
    account_label: String(row.account_label || ""),
    account_email: String(row.account_email || ""),
    sender_address: String(row.sender_address || ""),
    created_at: String(row.created_at || ""),
  }));
}

export async function trustRemoteContentSender(
  userId: string,
  accountIdValue: unknown,
  senderAddressValue: unknown,
  { dbClient = db }: { dbClient?: EmailWriteDb } = {},
): Promise<RemoteContentTrustEntry> {
  const accountId = String(accountIdValue || "").trim();
  const senderAddress = normalizeRemoteContentSenderAddress(senderAddressValue);
  if (!accountId || !senderAddress) {
    throw httpError(400, "A valid account_id and sender_address are required");
  }

  const account = await dbClient.execute({
    sql: `SELECT id
          FROM ea_accounts
          WHERE id = ? AND user_id = ? AND type IN ('gmail', 'icloud')
          LIMIT 1`,
    args: [accountId, userId],
  });
  if (!account.rows[0]) throw httpError(404, "Email account not found");

  await dbClient.execute({
    sql: `INSERT INTO ea_email_remote_content_trust
            (user_id, account_id, sender_address)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, account_id, sender_address) DO NOTHING`,
    args: [userId, accountId, senderAddress],
  });

  const entries = await listRemoteContentTrust(userId, { dbClient });
  const entry = entries.find((candidate) =>
    candidate.account_id === accountId && candidate.sender_address === senderAddress);
  if (!entry) throw httpError(500, "Trusted sender could not be loaded");
  return entry;
}

export async function removeRemoteContentTrust(
  userId: string,
  idValue: unknown,
  { dbClient = db }: { dbClient?: EmailWriteDb } = {},
): Promise<void> {
  const id = Number(idValue);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid trusted sender id");
  const result = await dbClient.execute({
    sql: "DELETE FROM ea_email_remote_content_trust WHERE id = ? AND user_id = ?",
    args: [id, userId],
  });
  if (Number(result.rowsAffected || 0) === 0) throw httpError(404, "Trusted sender not found");
}
