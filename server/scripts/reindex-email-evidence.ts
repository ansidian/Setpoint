import "dotenv/config";
import type { Row } from "@libsql/client";
import type { NormalizedFetchedEmail } from "../../shared/types/email.ts";

function usage(): string {
  return `Usage: npm run email:reindex-evidence -- --uid <exact-email-uid> [--apply]

Refetches one existing indexed email through its configured provider.
Default: dry run; reports body lengths and whether indexed content would change.
--apply: updates the email index, full-text search, and stale search embeddings.
Requires EA_USER_ID and the usual database/provider environment configuration.

This command does not refresh triage, saved financial plans, or snapshots.
Existing decisions need a separate explicit re-triage; no jobs are queued here.
Email bodies are never printed.`;
}

function parseArgs(argv: string[]): { uid: string; apply: boolean; help: boolean } {
  let uid = "";
  let apply = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--apply") apply = true;
    else if (arg === "--uid") {
      const value = argv[++index];
      if (uid || !value || value.startsWith("--")) throw new Error("Provide exactly one --uid value.");
      uid = value;
    } else throw new Error("Unknown argument. Use --help for usage.");
  }
  if (!help && (!/^(gmail|icloud)-[^\s*?]+$/.test(uid))) {
    throw new Error("--uid must identify exactly one Gmail or iCloud email; wildcards are not supported.");
  }
  return { uid, apply, help };
}

function indexedEnvelope(row: Row, bodyText: string): NormalizedFetchedEmail {
  const fromName = String(row.from_name || "");
  const fromAddress = String(row.from_address || "");
  return {
    uid: String(row.uid),
    account_id: String(row.account_id),
    account_label: String(row.account_label || ""),
    account_email: String(row.account_email || ""),
    account_color: String(row.account_color || "#818cf8"),
    account_icon: String(row.account_icon || "Mail"),
    from: fromName,
    from_email: fromAddress,
    subject: String(row.subject || ""),
    body_preview: String(row.body_snippet || ""),
    body_text: bodyText,
    date: String(row.email_date || ""),
    read: Boolean(Number(row.read)),
    thread_id: row.thread_id == null ? null : String(row.thread_id),
    message_id: row.message_id == null ? null : String(row.message_id),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const userId = process.env.EA_USER_ID?.trim();
  if (!userId) throw new Error("EA_USER_ID is required.");

  const { default: db } = await import("../db/connection.ts");
  try {
    const { resolveDatabaseClientConfig } = await import("../db/config.ts");
    const { fetchEmailBodyForUid, findAccountByUid } = await import("../email/email-provider-adapters.ts");
    const { indexEmails, EMAIL_INDEX_BODY_TEXT_MAX_CHARS } = await import("../email/email-index.ts");
    const { emailEvidenceText, boundEmailEvidence } = await import("../email/email-evidence.ts");
    const loadRow = async (): Promise<Row> => {
      const result = await db.execute({
        sql: "SELECT * FROM ea_email_index WHERE user_id = ? AND uid = ? LIMIT 1",
        args: [userId, options.uid],
      });
      const row = result.rows[0];
      if (!row) throw new Error("No indexed email matches this owner and UID.");
      return row;
    };
    const existing = await loadRow();
    let normalized: string;
    if (options.uid.startsWith("gmail-")) {
      const found = await findAccountByUid(userId, options.uid);
      if (!found || found.type !== "gmail") throw new Error("Configured Gmail account could not be resolved.");
      const prefix = `gmail-${found.account.uid_account_id || found.account.id}-`;
      if (!options.uid.startsWith(prefix)) throw new Error("Email UID does not match the resolved Gmail account.");
      const messageId = options.uid.slice(prefix.length);
      if (!messageId) throw new Error("Email UID has no Gmail message ID.");
      const { fetchEmailsByIds } = await import("../email/gmail.ts");
      // Reuse ingestion's MIME-alternative selection, including its plain-text
      // preference. The reader body chooses HTML and is not equivalent evidence.
      const emails = await fetchEmailsByIds(found.account, [messageId]);
      const fetched = emails.find((email) => email.uid === `gmail-${found.account.id}-${messageId}`);
      if (!fetched) throw new Error("Gmail did not return the requested email; the existing index was not changed.");
      normalized = fetched.body_text;
    } else {
      const body = await fetchEmailBodyForUid(userId, options.uid);
      const raw = "html_body" in body ? body.html_body : body.body;
      normalized = emailEvidenceText(raw, "html_body" in body ? "html" : "auto");
    }
    if (!normalized.trim()) throw new Error("Provider returned no readable body; the existing index was not changed.");
    const bodyText = boundEmailEvidence(normalized, EMAIL_INDEX_BODY_TEXT_MAX_CHARS);
    // Refetch local presentation/read metadata after provider IO, so a read-state
    // change during the request is not overwritten by the earlier snapshot.
    const current = await loadRow();
    if (current.account_id !== existing.account_id) {
      throw new Error("Indexed account changed during refetch; retry against the current account.");
    }
    const changed = String(current.body_text || "") !== bodyText;
    if (options.apply && changed) await indexEmails(userId, [indexedEnvelope(current, bodyText)]);
    console.log(JSON.stringify({
      mode: options.apply ? "apply" : "dry_run",
      database: resolveDatabaseClientConfig().mode,
      uid: options.uid,
      previousBodyChars: String(current.body_text || "").length,
      normalizedBodyChars: normalized.length,
      indexedBodyChars: bodyText.length,
      changed,
      applied: options.apply && changed,
      triageAndFinancialPlans: "unchanged; separate explicit re-triage required",
    }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Email evidence reindex failed.");
  process.exitCode = 1;
});
