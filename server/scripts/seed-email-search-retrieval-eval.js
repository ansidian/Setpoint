import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import db from "../db/connection.js";

const outputPath = process.argv[2] || "server/briefing/evals/local/email-search-retrieval.suggestions.json";
const userId = process.argv[3] || process.env.EA_USER_ID;

const FAMILIES = [
  { id: "amazon_return", queries: ["amazon return drop off", "amazon return deadline"], terms: ["amazon", "return"] },
  { id: "payment_due", queries: ["credit card payment due", "payment due"], terms: ["payment", "due"] },
  { id: "payment_receipts", queries: ["payment confirmation", "receipt"], terms: ["payment", "receipt"] },
  { id: "security_auth", queries: ["google sign in alert", "verification code"], terms: ["security", "verification"] },
  { id: "github_infra", queries: ["github run failed", "personal access token request"], terms: ["github", "failed"] },
  { id: "school_deadline", queries: ["commencement registration deadline", "guest tickets"], terms: ["registration", "deadline"] },
  { id: "usps_delivery", queries: ["USPS package arriving today", "informed delivery package"], terms: ["usps", "package"] },
];

function whereForTerms(terms) {
  return terms.map(() => "(lower(idx.subject) LIKE ? OR lower(idx.body_snippet) LIKE ?)").join(" OR ");
}

async function sampleFamily(family) {
  const args = [userId];
  for (const term of family.terms) {
    args.push(`%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`);
  }
  const result = await db.execute({
    sql: `SELECT idx.uid, idx.account_id, idx.account_label, idx.from_address,
                 idx.subject, idx.body_snippet, idx.email_date, idx.read,
                 triage.lane, triage.category, triage.urgency
          FROM ea_email_index idx
          LEFT JOIN ea_email_triage triage
            ON triage.user_id = idx.user_id
           AND triage.account_id = idx.account_id
           AND triage.email_id = idx.uid
          WHERE idx.user_id = ?
            AND (${whereForTerms(family.terms)})
          ORDER BY
            CASE
              WHEN triage.lane = 'needs_attention' THEN 0
              WHEN triage.urgency = 'high' THEN 1
              ELSE 2
            END,
            idx.email_date DESC
          LIMIT 12`,
    args,
  });
  return {
    family: family.id,
    queries: family.queries,
    samples: result.rows.map((row) => ({
      uid: row.uid,
      account_id: row.account_id,
      account_label: row.account_label,
      from_address: row.from_address,
      subject: row.subject,
      body_snippet: row.body_snippet,
      email_date: row.email_date,
      read: Boolean(row.read),
      lane: row.lane || null,
      category: row.category || null,
      urgency: row.urgency || null,
    })),
  };
}

async function main() {
  if (!userId) {
    throw new Error("EA_USER_ID or explicit userId argument is required");
  }
  const suggestions = {
    version: 1,
    generated_at: new Date().toISOString(),
    note: "Local suggestions only. Manually copy selected UIDs into email-search-retrieval.local.json expected_uids/must_not_top.",
    families: [],
  };
  for (const family of FAMILIES) {
    suggestions.families.push(await sampleFamily(family));
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(suggestions, null, 2)}\n`);
  console.log(`[Email Search Retrieval Eval] Wrote local suggestions to ${outputPath}`);
}

main().catch((err) => {
  console.error("[Email Search Retrieval Eval] Seed failed:", err.message);
  process.exit(1);
});
