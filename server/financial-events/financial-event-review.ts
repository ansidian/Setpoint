import { createHash } from "node:crypto";
import db from "../db/connection.ts";
import type { BillCandidate, FinancialEmailPlan, FinancialPlanReasonCode } from "../../shared/types/bills.ts";
import type { FinancialEventReviewItem, FinancialEventReviewResponse, FinancialReviewAttention,
  FinancialReviewChangeCursor, FinancialReviewChangesResponse } from "../../shared/types/financial-review.ts";
import { selectSemanticBillAmount } from "../bills/financial-email-planner.ts";
import { completionBlocker, type FinancialOwnerCompletion } from "./financial-event-completion-model.ts";
import type { FinancialStatusDb } from "./financial-event-store.ts";

const PAGE_SIZE = 20;
const CHANGE_PAGE_SIZE = 50;

// Select only current, owner-scoped source links. A related receipt is a source
// of the event, not a second queue item. Unknown assessment failures stay in the
// coverage report rather than turning every incoming email into a finance task.
const REVIEW_ROWS = `WITH review AS (
  SELECT 'event:' || event.id AS entity_id, source.email_uid,
    email.subject, email.from_name, email.from_address, email.email_date_utc AS received_at,
    event.status AS state, COALESCE(event.reason, source.last_error) AS reason,
    (SELECT COUNT(*) FROM ea_financial_documents related
      WHERE related.user_id = event.user_id AND related.event_id = event.id) AS related_emails,
    event.created_at, event.updated_at, event.next_attempt_at, event.attempted_at,
    event.operation_json, event.outcome_json, event.plan_json, event.owner_completion_json, source.candidate_json
  FROM ea_financial_events event
  JOIN ea_financial_documents source ON source.user_id = event.user_id AND source.event_id = event.id
  JOIN ea_email_index email ON email.user_id = source.user_id AND email.uid = source.email_uid
  WHERE event.user_id = ? AND event.status IN ('waiting', 'needs_review')
    AND source.id = (SELECT MIN(choice.id) FROM ea_financial_documents choice
      JOIN ea_email_index current_email ON current_email.user_id = choice.user_id AND current_email.uid = choice.email_uid
      WHERE choice.user_id = event.user_id AND choice.event_id = event.id)
  UNION ALL
  SELECT 'document:' || source.id, source.email_uid,
    email.subject, email.from_name, email.from_address, email.email_date_utc,
    'waiting', source.last_error, 1,
    source.created_at, source.updated_at, source.next_attempt_at, NULL,
    NULL, NULL, NULL, NULL, source.candidate_json
  FROM ea_financial_documents source
  JOIN ea_email_index email ON email.user_id = source.user_id AND email.uid = source.email_uid
  WHERE source.user_id = ? AND source.event_id IS NULL AND source.status = 'retry' AND source.candidate_json IS NOT NULL
)`;

const DETAILS_REASONS = new Set([
  "Related emails contain conflicting payment details.",
  "Waiting for an explicit transaction or payment date.",
  "Waiting for complete payment amount, currency and account details.",
  "Waiting for complete, consistent payment details.",
  "Waiting for a clear payment purpose.",
  "Waiting for evidence that distinguishes similar purchases.",
]);
const DETAILS_CODES = new Set<FinancialPlanReasonCode>([
  "semantic_event_missing", "semantic_event_ambiguous", "canonical_amount_missing", "minimum_due_only",
  "due_date_missing", "due_date_invalid", "account_target_unresolved", "payee_target_unresolved",
  "from_account_target_unresolved", "to_account_target_unresolved", "schedule_target_unresolved",
  "credit_account_evidence_missing", "target_evidence_conflict", "target_ranking_unresolved", "blocking_warning",
]);
const RETRY_REASONS = new Set([
  "Financial processing is paused while email AI is disabled.",
  "Waiting for verified sender authentication.",
  "The current Actual check has not established a safe operation.",
  "New source evidence arrived; the operation will be checked again.",
]);
const RETRY_CODES = new Set<FinancialPlanReasonCode>([
  "provider_unavailable", "actual_metadata_unavailable", "reconciliation_unavailable",
  "sender_authentication_failed", "sender_authentication_unavailable", "automation_class_observe_only",
]);

function objectJson<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : null;
  } catch { return null; }
}

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function attentionFor(row: Record<string, unknown>, canComplete: boolean, plan: FinancialEmailPlan | null): FinancialReviewAttention {
  if (row.state === "needs_review") {
    const outcome = objectJson<{ outcome?: string }>(row.outcome_json);
    return !canComplete || outcome?.outcome === "needs_review" ? "check_actual" : "complete_details";
  }
  // A saved plan can predate the current provider failure. Operational waiting
  // reasons take precedence so stale missing-field reasons never send an alert.
  const reason = String(row.reason || "");
  if (!canComplete || row.attempted_at != null || row.operation_json != null || RETRY_REASONS.has(reason)
    || /^(Financial processing will retry|Financial assessment will retry|Verifying the previous Actual operation):/.test(reason)) return "retrying";
  // These current worker decisions can also precede planning; an older failed
  // metadata check must not hide newly conflicting or incomplete source facts.
  if (DETAILS_REASONS.has(reason) && reason !== "Waiting for complete, consistent payment details.") return "complete_details";
  const blockers = Array.isArray(plan?.reviewReasons) ? plan.reviewReasons.filter((item) => item.blocking) : [];
  if (blockers.some((item) => RETRY_CODES.has(item.code))) return "retrying";
  if (DETAILS_REASONS.has(reason) || blockers.some((item) => item.field !== "category" && DETAILS_CODES.has(item.code))) return "complete_details";
  // Waiting is also used for automatic retries with provider-owned messages.
  // Only explicit evidence blockers should interrupt the owner.
  return "retrying";
}

function projectReviewItem(row: Record<string, unknown>): FinancialEventReviewItem {
  const plan = objectJson<FinancialEmailPlan>(row.plan_json);
  const confirmed = objectJson<FinancialOwnerCompletion>(row.owner_completion_json);
  const canComplete = !completionBlocker({
    attemptedAt: row.attempted_at == null ? null : Number(row.attempted_at),
    operation: objectJson(row.operation_json), outcome: objectJson(row.outcome_json),
    plan: plan?.reconciliation ? plan : null, ownerCompletion: confirmed,
    status: row.state === "needs_review" ? "needs_review" : "waiting",
  });
  const candidate = plan?.candidate || objectJson<BillCandidate>(row.candidate_json) || {};
  const amount = confirmed?.entry?.amount ?? selectSemanticBillAmount(candidate)?.amount;
  return {
    id: String(row.entity_id), emailUid: String(row.email_uid), subject: String(row.subject || ""),
    from: String(row.from_name || row.from_address || ""), receivedAt: String(row.received_at || ""),
    payee: nonempty(confirmed?.entry?.payee) || nonempty(plan?.targets?.payee?.label) || nonempty(candidate.payee_hint) || nonempty(candidate.payee),
    amount: typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: confirmed?.entry ? "USD" : nonempty(candidate.currency),
    state: row.state === "needs_review" ? "needs_review" : "waiting",
    reason: String(row.reason || "Checking the financial entry."), relatedEmails: Number(row.related_emails),
    createdAt: Number(row.created_at), nextAttemptAt: row.next_attempt_at == null ? null : Number(row.next_attempt_at),
    canComplete, attention: attentionFor(row, canComplete, plan),
  };
}

function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }

/** Read-only queue; displaying it never assesses email or retries an Actual write. */
export async function listFinancialEventReview(userId: string, {
  offset = 0, dbClient = db,
}: { offset?: number; dbClient?: FinancialStatusDb } = {}): Promise<FinancialEventReviewResponse> {
  if (!userId || !Number.isSafeInteger(offset) || offset < 0) invalid("Financial review offset must be a nonnegative integer");
  // The count and page use the same statement and snapshot, including an empty
  // page beyond the end of the queue.
  const result = await dbClient.execute({
    sql: `${REVIEW_ROWS}, total AS (SELECT COUNT(*) AS total FROM review),
      page AS (SELECT * FROM review ORDER BY created_at DESC, entity_id DESC LIMIT ${PAGE_SIZE} OFFSET ?)
      SELECT page.*, total.total FROM total LEFT JOIN page ON 1 = 1 ORDER BY page.created_at DESC, page.entity_id DESC`,
    args: [userId, userId, offset],
  });
  return { items: result.rows.filter((row) => row.entity_id != null).map(projectReviewItem),
    total: Number(result.rows[0]?.total || 0), offset, limit: PAGE_SIZE };
}

/** Advance through silent exceptions too, so retries cannot hide a later alert. */
export async function readFinancialReviewChanges(userId: string, {
  after, dbClient = db,
}: { after?: FinancialReviewChangeCursor; dbClient?: FinancialStatusDb } = {}): Promise<FinancialReviewChangesResponse> {
  if (!userId || (after && (!Number.isSafeInteger(after.updatedAt) || after.updatedAt < 0
    || typeof after.id !== "string" || after.id.length > 600))) invalid("Financial review cursor is invalid");
  const result = await dbClient.execute({
    sql: `${REVIEW_ROWS} SELECT * FROM review
      ${after ? "WHERE updated_at > ? OR (updated_at = ? AND entity_id > ?)" : ""}
      ORDER BY updated_at, entity_id LIMIT ${CHANGE_PAGE_SIZE + 1}`,
    args: [userId, userId, ...(after ? [after.updatedAt, after.updatedAt, after.id] : [])],
  });
  const page = result.rows.slice(0, CHANGE_PAGE_SIZE);
  const items = page.flatMap((row) => {
    const item = projectReviewItem(row);
    if (item.attention === "retrying") return [];
    const confirmationId = objectJson<FinancialOwnerCompletion>(row.owner_completion_json)?.id || null;
    return [{ key: `financial-review:${createHash("sha256").update(JSON.stringify([item.emailUid, item.attention, confirmationId])).digest("hex")}`,
      emailUid: item.emailUid }];
  });
  const last = page.at(-1);
  return { items, cursor: last ? { updatedAt: Number(last.updated_at), id: String(last.entity_id) } : after || null,
    hasMore: result.rows.length > CHANGE_PAGE_SIZE };
}
