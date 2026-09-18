/** Queue post-cutover recovery; the running application retains worker locks and sync ownership. */
import "dotenv/config";
import { stat } from "node:fs/promises";
import { resolveDatabaseClientConfig } from "../db/config.ts";
import { canonicalizeConfiguredAccounts } from "../platform/account-canonical.ts";
import type { GmailSyncAccount } from "../email/email-sync-types.ts";

async function main(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== "--apply") {
    console.error("Usage: npm run migration:catchup -- --apply (queues recovery on local production only)");
    process.exitCode = 1;
    return;
  }
  if (process.env.NODE_ENV !== "production" || process.env.EA_DB_ADAPTER !== "sqlite") {
    console.error("Cutover recovery requires NODE_ENV=production and EA_DB_ADAPTER=sqlite");
    process.exitCode = 1;
    return;
  }
  const config = resolveDatabaseClientConfig();
  if (config.adapter !== "sqlite" || !(await stat(new URL(config.client.url))).isFile()) {
    console.error("Cutover recovery requires an existing local production database file");
    process.exitCode = 1;
    return;
  }

  // Validate the target before importing modules that open the shared connection.
  const { default: db } = await import("../db/connection.ts");
  try {
    const { getOwner } = await import("../auth/owner-store.ts");
    const owner = await getOwner();
    if (!owner) {
      console.error("Cutover recovery requires an existing claimed owner");
      process.exitCode = 1;
      return;
    }
    const { rows } = await db.execute({
      sql: "SELECT * FROM ea_accounts WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC",
      args: [owner.userId],
    });
    const accounts = canonicalizeConfiguredAccounts(rows).filter((account) => account.type === "gmail");
    const { fetchGmailProfileHistoryId } = await import("../email/gmailSyncClient.ts");
    const { enqueueTriageJob } = await import("../email/gmail-sync.ts");
    const { requestCalendarPushSync } = await import("../calendar/calendar-push-channels.ts");
    let gmailQueuedOrExisting = 0;
    let gmailFailed = 0;
    for (const row of accounts) {
      if (!row.credentials_encrypted || row.needs_reauth) {
        gmailFailed++;
        continue;
      }
      try {
        const account = row as unknown as GmailSyncAccount;
        const historyId = await fetchGmailProfileHistoryId(account, {
          fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
        });
        if (!historyId || !/^\d+$/.test(historyId)) throw new Error("Missing history cursor");
        await enqueueTriageJob({
          userId: owner.userId,
          accountId: account.id,
          jobType: "gmail_history_sync",
          idempotencyKey: `gmail_history_sync:${owner.userId}:${account.id}:${historyId}`,
          priority: 1,
          payload: { emailAddress: account.email, historyId },
        });
        gmailQueuedOrExisting++;
      } catch {
        // Provider errors can include mailbox addresses and response bodies.
        gmailFailed++;
      }
    }
    let calendarQueued = false;
    try {
      await requestCalendarPushSync(owner.userId);
      calendarQueued = true;
    } catch {
      process.exitCode = 1;
    }
    console.log(JSON.stringify({ gmailAccounts: accounts.length, gmailQueuedOrExisting, gmailFailed, calendarQueued }));
    if (gmailFailed) process.exitCode = 1;
  } finally {
    db.close();
  }
}

try {
  await main();
} catch {
  console.error("Cutover recovery failed; check local database configuration, encryption key, and provider connection health");
  process.exitCode = 1;
}
