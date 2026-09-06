import db from "../db/connection.ts";
import type { PinnedEmailSnapshot, SnoozedEmailEntry } from "../../shared/types/email.ts";
import type { EmailWriteDb } from "./email-persistence-types.ts";

const str = (value: unknown): string | null => value == null ? null : String(value);

function parseJson(value: unknown): PinnedEmailSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PinnedEmailSnapshot : null;
  } catch { return null; }
}

// Persisted deferred status owns membership, including overdue wakes awaiting retry.
// Hydration never fetches a provider body or grants active-snapshot membership.
export async function loadSnoozedEntries(userId: string, { dbClient = db }: { dbClient?: EmailWriteDb } = {}): Promise<SnoozedEmailEntry[]> {
  const snoozes = await dbClient.execute({
    sql: `SELECT email_id, until_ts, email_snapshot,
                 EXISTS(SELECT 1 FROM ea_pinned_emails p WHERE p.user_id = ea_snoozed_emails.user_id AND p.email_id = ea_snoozed_emails.email_id) AS pinned
          FROM ea_snoozed_emails WHERE user_id = ? AND status = 'snoozed' ORDER BY until_ts, email_id`,
    args: [userId],
  });
  if (!snoozes.rows.length) return [];
  const snoozeRows = snoozes.rows;
  const uids = snoozeRows.map((row) => String(row.email_id));
  const placeholders = uids.map(() => "?").join(",");
  const [index, triage, accounts] = await Promise.all([
    dbClient.execute({
      sql: `SELECT uid, subject, from_name, from_address, body_snippet, email_date, read, account_id, account_label, account_email, account_color, account_icon, verification_code, verification_code_kind, verification_code_active_until
            FROM ea_email_index WHERE user_id = ? AND uid IN (${placeholders})`,
      args: [userId, ...uids],
    }),
    dbClient.execute({
      sql: `SELECT account_id, email_id, lane, urgency, category, handled_at, provider_state, summary, action, deadline_at, escalation_badge, triage_status, bill_candidate_json
            FROM ea_email_triage WHERE user_id = ? AND email_id IN (${placeholders})`,
      args: [userId, ...uids],
    }),
    dbClient.execute({ sql: "SELECT id FROM ea_accounts WHERE user_id = ?", args: [userId] }),
  ]);
  const accountIds = new Set(accounts.rows.map((row) => String(row.id)));
  const indexByUid = new Map((index.rows).map((row) => [row.uid, row]));
  const triageByUid = new Map((triage.rows).map((row) => [String(row.account_id) + ":" + String(row.email_id), row]));
  return snoozeRows.map((row) => {
    const snap: PinnedEmailSnapshot = parseJson(row.email_snapshot) || {};
    const idx = indexByUid.get(row.email_id);
    const accountId = String(idx?.account_id || snap.account_id || "") || null;
    const tri = triageByUid.get(accountId + ":" + String(row.email_id));
    const billCandidate = parseJson(tri?.bill_candidate_json) || (snap.extractedBill && typeof snap.extractedBill === "object" ? snap.extractedBill as Record<string, unknown> : null);
    const codeKind = idx?.verification_code_kind;
    return {
      account_unavailable: !accountId || !accountIds.has(accountId),
      triage_status: str(tri?.triage_status),
      bill_candidate: billCandidate, hasBill: !!billCandidate || !!snap.hasBill,
      claude: snap.claude && typeof snap.claude === "object" ? snap.claude as SnoozedEmailEntry["claude"] : null,
      aiSummary: str(snap.aiSummary),
      verification_code: idx?.verification_code && idx.verification_code_active_until && (codeKind === "numeric" || codeKind === "alphanumeric" || codeKind === "hyphenated")
        ? { code: String(idx.verification_code), kind: codeKind, active_until: String(idx.verification_code_active_until), label: "Verification code" as const } : null,
      uid: String(row.email_id),
      until_ts: Number(row.until_ts),
      pinned: !!row.pinned,
      missing_source: !idx && !snap.subject && !snap.preview,
      summary: str(tri?.summary ?? snap.summary),
      action: str(tri?.action ?? snap.action),
      deadline_at: str(tri?.deadline_at ?? snap.deadline_at),
      escalation_badge: str(tri?.escalation_badge ?? snap.escalation_badge),
      account_id: accountId,
      subject: str(idx?.subject ?? snap.subject) ?? "Message unavailable",
      from_name: str(idx?.from_name ?? snap.from) ?? "Unknown sender",
      from_address: str(idx?.from_address ?? snap.from_email) ?? "",
      preview: str(idx?.body_snippet ?? snap.preview) ?? "",
      date: str(idx?.email_date ?? snap.date),
      read: idx?.read != null ? !!idx?.read : !!snap.read,
      account_label: str(idx?.account_label ?? snap.account_label),
      account_email: str(idx?.account_email ?? snap.account_email),
      account_color: str(idx?.account_color ?? snap.account_color),
      account_icon: str(idx?.account_icon ?? snap.account_icon),
      lane: str(tri?.lane ?? snap.lane),
      urgency: str(tri?.urgency ?? snap.urgency),
      category: str(tri?.category ?? snap.category),
      handled_at: str(tri?.handled_at),
      provider_state: str(tri?.provider_state),
    };
  });
}
