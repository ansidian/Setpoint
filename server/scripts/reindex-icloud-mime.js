// Targeted iCloud raw-MIME reindex (audit D1). Scans ea_email_index for
// iCloud rows whose body_text still looks like undecoded MIME, then
// re-fetches the covering date window from iCloud and upserts via
// indexEmails (which rewrites FTS and invalidates embeddings on content
// change). DRY RUN by default; pass --apply to write.
// Usage: node server/scripts/reindex-icloud-mime.js [--apply]
import "dotenv/config";
import db from "../db/connection.ts";
import { looksLikeRawMime } from "../email/mime-artifacts.js";
import { loadUserConfig } from "../platform/config-service.ts";
import { fetchAllEmails } from "../email/email-fetch.js";
import { indexEmails } from "../email/email-index.js";

const apply = process.argv.includes("--apply");
const userId = process.env.EA_USER_ID;
if (!userId) {
  console.error("EA_USER_ID not set in env");
  process.exit(1);
}

async function scanPolluted() {
  const polluted = [];
  const pageSize = 250;
  for (let offset = 0; ; offset += pageSize) {
    const { rows } = await db.execute({
      sql: `SELECT uid, body_text, email_date_utc FROM ea_email_index
            WHERE user_id = ? AND uid LIKE 'icloud-%'
            ORDER BY uid LIMIT ? OFFSET ?`,
      args: [userId, pageSize, offset],
    });
    if (!rows.length) break;
    for (const row of rows) {
      if (looksLikeRawMime(row.body_text)) polluted.push(row);
    }
  }
  return polluted;
}

const before = await scanPolluted();
const oldest = before.reduce(
  (min, r) => (r.email_date_utc && r.email_date_utc < min ? r.email_date_utc : min),
  new Date().toISOString(),
);
console.log(`[reindex-icloud-mime] polluted=${before.length} oldest=${oldest}`);
if (!before.length || !apply) {
  if (!apply) console.log("[reindex-icloud-mime] dry run — pass --apply to reindex");
  process.exit(0);
}

const hoursBack = Math.ceil((Date.now() - Date.parse(oldest)) / 3_600_000) + 24;
const { accounts } = await loadUserConfig(userId);
const icloudAccounts = accounts.filter((a) => a.type === "icloud");
console.log(`[reindex-icloud-mime] refetching ${icloudAccounts.length} iCloud account(s), hoursBack=${hoursBack}`);
const emails = await fetchAllEmails(icloudAccounts, hoursBack);
console.log(`[reindex-icloud-mime] fetched ${emails.length} emails`);
await indexEmails(userId, emails);

const after = await scanPolluted();
console.log(`[reindex-icloud-mime] polluted after=${after.length} (residual rows are likely no longer in INBOX — audit D3 lifecycle, out of scope)`);
process.exit(0);
