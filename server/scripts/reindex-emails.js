// Ad-hoc additive email re-index. Re-fetches emails over a time window and
// upserts them via indexEmails — existing rows keep their read state, new
// rows get inserted, searchable content is refreshed.
// Usage: node server/scripts/reindex-emails.js [hoursBack]
// Default hoursBack = 720 (30 days).
import "dotenv/config";
import { loadUserConfig } from "../platform/config-service.ts";
import { fetchAllEmails } from "../email/email-fetch.js";
import { indexEmails } from "../email/email-index.js";

const userId = process.env.EA_USER_ID;
if (!userId) {
  console.error("EA_USER_ID not set in env");
  process.exit(1);
}

const hoursBack = Number(process.argv[2]) || 720;

console.log(`[reindex] userId=${userId} hoursBack=${hoursBack}`);

const { accounts } = await loadUserConfig(userId);
console.log(`[reindex] loaded ${accounts.length} accounts`);

const start = Date.now();
const emails = await fetchAllEmails(accounts, hoursBack);
console.log(`[reindex] fetched ${emails.length} emails in ${Date.now() - start}ms`);

await indexEmails(userId, emails);
console.log(`[reindex] done`);
process.exit(0);
