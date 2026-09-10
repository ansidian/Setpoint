import { createHash } from "node:crypto";
import db from "../db/connection.ts";
import type { BillCandidate, FinancialEmailPlan, FinancialPlanReasonCode } from "../../shared/types/bills.ts";
import type { FinancialEventReviewItem, FinancialReviewAttention,
  FinancialReviewChangeCursor, FinancialReviewChangesResponse } from "../../shared/types/financial-review.ts";
import { selectSemanticBillAmount } from "../bills/financial-email-planner.ts";
import { canReviewKnownDetails, completionBlocker, hasPendingFinancialPlan, type FinancialOwnerCompletion } from "./financial-event-completion-model.ts";
import type { FinancialEvent, FinancialStatusDb } from "./financial-event-store.ts";

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
    event.operation_json, event.outcome_json, event.plan_json, event.owner_completion_json, source.candidate_json,
    event.collection_required,
    NOT EXISTS (SELECT 1 FROM ea_financial_documents changed WHERE changed.user_id = event.user_id
      AND changed.event_id = event.id AND changed.dismissed_at IS NULL AND changed.processed_revision < changed.revision) AS sources_current
  FROM ea_financial_events event
  JOIN ea_financial_documents source ON source.user_id = event.user_id AND source.event_id = event.id
  JOIN ea_email_index email ON email.user_id = source.user_id AND email.uid = source.email_uid
  WHERE event.user_id = ? AND event.dismissed_at IS NULL AND event.status IN ('pending', 'processing', 'waiting', 'needs_review')
    AND source.id = (SELECT MIN(choice.id) FROM ea_financial_documents choice
      JOIN ea_email_index current_email ON current_email.user_id = choice.user_id AND current_email.uid = choice.email_uid
      WHERE choice.user_id = event.user_id AND choice.event_id = event.id)
  UNION ALL
  SELECT 'document:' || source.id, source.email_uid,
    email.subject, email.from_name, email.from_address, email.email_date_utc,
    'waiting', source.last_error, 1,
    source.created_at, source.updated_at, source.next_attempt_at, NULL,
    NULL, NULL, NULL, NULL, source.candidate_json, NULL, 1
  FROM ea_financial_documents source
  JOIN ea_email_index email ON email.user_id = source.user_id AND email.uid = source.email_uid
  WHERE source.user_id = ? AND source.dismissed_at IS NULL AND source.event_id IS NULL AND source.status = 'retry' AND source.candidate_json IS NOT NULL
)`;

const DETAILS_REASONS = new Set([
  "Related emails contain conflicting payment details.",
  "Waiting for an explicit transaction or payment date.",
  "Waiting for a supported transaction or payment date.",
  "Waiting for complete payment amount, currency and account details.",
  "Waiting for complete, consistent payment details.",
  "Waiting for a clear payment purpose.",
  "Waiting for evidence that distinguishes similar purchases.",
  "Review this candidate alongside similar purchases.",
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

function attentionFor(row: Record<string, unknown>, canComplete: boolean, plan: FinancialEmailPlan | null, reviewingDetails: boolean): FinancialReviewAttention {
  if (row.state === "needs_review") {
    const outcome = objectJson<{ outcome?: string }>(row.outcome_json);
    return !canComplete || outcome?.outcome === "needs_review" ? "check_actual" : "complete_details";
  }
  if (reviewingDetails) return "complete_details";
  if (row.state === "pending" || row.state === "processing") return "retrying";
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

export function projectReviewItem(row: Record<string, unknown>): FinancialEventReviewItem {
  let plan = objectJson<FinancialEmailPlan>(row.plan_json);
  const confirmed = objectJson<FinancialOwnerCompletion>(row.owner_completion_json);
  const status: FinancialEvent["status"] = row.state === "pending" || row.state === "processing" || row.state === "needs_review" || row.state === "settled" ? row.state : "waiting";
  const event = {
    attemptedAt: row.attempted_at == null ? null : Number(row.attempted_at),
    operation: objectJson(row.operation_json), outcome: objectJson(row.outcome_json),
    plan: plan?.reconciliation ? plan : null, ownerCompletion: confirmed,
    dismissedAt: row.dismissed_at == null ? null : Number(row.dismissed_at),
    collectionRequired: Number(row.collection_required) === 1,
    status,
  };
  const completedBlocker = completionBlocker(event);
  const sourcePending = !completedBlocker && !confirmed && row.sources_current === 0;
  const canComplete = !completedBlocker && !sourcePending;
  if (!completedBlocker && (hasPendingFinancialPlan(event) || sourcePending)) plan = null;
  const savedCandidate = sourcePending ? null : objectJson<BillCandidate>(row.candidate_json);
  const reviewingDetails = canReviewKnownDetails(String(row.entity_id).startsWith("document:") ? null : event, savedCandidate);
  const candidate = plan?.candidate || savedCandidate || {};
  const amount = confirmed?.entry?.amount ?? selectSemanticBillAmount(candidate)?.amount;
  return {
    id: String(row.entity_id), emailUid: String(row.email_uid), subject: String(row.subject || ""),
    from: String(row.from_name || row.from_address || ""), receivedAt: String(row.received_at || ""),
    payee: nonempty(confirmed?.entry?.payee) || nonempty(plan?.targets?.payee?.label) || nonempty(candidate.payee_hint) || nonempty(candidate.payee),
    amount: typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: confirmed?.entry ? "USD" : nonempty(candidate.currency),
    state: reviewingDetails || row.state === "needs_review" ? "needs_review" : "waiting",
    reason: sourcePending ? "Checking updated source details." : reviewingDetails ? "Review the details before recording in Actual." : String(row.reason || "Checking the financial entry."), relatedEmails: Number(row.related_emails),
    createdAt: Number(row.created_at), nextAttemptAt: row.next_attempt_at == null ? null : Number(row.next_attempt_at),
    canComplete, attention: sourcePending ? "retrying" : attentionFor(row, canComplete, plan, reviewingDetails),
  };
}

function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }

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
