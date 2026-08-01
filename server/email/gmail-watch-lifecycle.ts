import db from "../db/connection.ts";
import { requestGmailWatch } from "./gmailSyncClient.ts";
import { markWatchError, persistGmailWatchState } from "./gmailWatchStore.ts";
import type { EmailWriteDb } from "./email-persistence-types.ts";
import type { EmailFetch, GmailSyncAccount } from "./email-sync-types.ts";
import { syncErrorMessage } from "./email-sync-types.ts";

const WATCH_RENEWAL_LEAD_MS = 24 * 60 * 60 * 1000;

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
