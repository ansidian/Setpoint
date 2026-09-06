import { BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS } from "./bill-semantic-prompt.ts";
import { hasFinancialSemanticConflict, hasStrongFinancialType, hasVerbatimFinancialEvidence, shouldAttemptFinancialEmailTypeVerification } from "./financialEmailClassificationPolicy.ts";
import {
  BILL_EVENT_KINDS,
  type BillCandidate,
  type BillEventVerification,
  type BillExtractionProvider,
} from "../../shared/types/bills.ts";

export interface BillEventVerificationResult {
  candidate: BillCandidate;
  usage: Record<string, unknown>;
}

const EVENTS_REQUIRING_OPERATION_DATE = new Set<BillCandidate["event_kind"]>([
  "statement_issued",
  "payment_due",
  "payment_scheduled",
  "account_transfer_pending",
  "account_transfer_completed",
  "card_payment_completed",
  "payment_completed",
  "purchase",
  "refund",
  "bill_issued",
  "reward",
]);

function needsSettlementSemantics(candidate: BillCandidate): boolean {
  return ["reward", "account_transfer_pending", "account_transfer_completed"].includes(String(candidate.event_kind || ""))
    && !candidate.event_verification
    && (!candidate.settlement_kind || !candidate.provider_reference);
}

function validYmd(value: unknown): boolean {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function hasExplicitDateForYmd(evidence: unknown, value: unknown): boolean {
  if (!validYmd(value)) return false;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = monthNames[month - 1]!;
  const shortMonth = monthName.slice(0, 3);
  const source = String(evidence || "");
  const patterns = [
    new RegExp(`\\b${year}[-/]0?${month}[-/]0?${day}\\b`),
    new RegExp(`\\b0?${month}[-/]0?${day}[-/]${year}\\b`),
    new RegExp(`\\b(?:${shortMonth}|${monthName})\\.?\\s+0?${day}(?:st|nd|rd|th)?[,]?\\s+${year}\\b`, "i"),
    new RegExp(`\\b0?${day}(?:st|nd|rd|th)?\\s+(?:${shortMonth}|${monthName})\\.?[,]?\\s+${year}\\b`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

function needsOperationDate(candidate: BillCandidate): boolean {
  return EVENTS_REQUIRING_OPERATION_DATE.has(candidate.event_kind) && !validYmd(candidate.due_date);
}

export function shouldVerifyBillEvent(candidate: BillCandidate): boolean {
  return !candidate.event_kind
    || candidate.event_kind === "other"
    || needsOperationDate(candidate)
    || needsSettlementSemantics(candidate)
    || shouldAttemptFinancialEmailTypeVerification(candidate)
    || (Boolean(candidate.event_kind) && Number(candidate.event_confidence) < 0.8);
}

function metadata(
  status: BillEventVerification["status"],
  provider: string,
  model: string,
): BillEventVerification {
  return { status, provider, model };
}

function usableEvent(candidate: BillCandidate, content: string): boolean {
  return Boolean(
    candidate.event_kind
    && candidate.event_kind !== "other"
    && BILL_EVENT_KINDS.includes(candidate.event_kind)
    && Number(candidate.event_confidence) >= 0.7
    && hasVerbatimFinancialEvidence(content, candidate.event_evidence),
  );
}

export async function verifyBillEvent({
  content,
  candidate,
  provider,
  providerId,
  model,
}: {
  content: string;
  candidate: BillCandidate;
  provider: BillExtractionProvider;
  providerId: string;
  model: string;
}): Promise<BillEventVerificationResult> {
  if (!shouldVerifyBillEvent(candidate)) return { candidate, usage: {} };

  const verifyType = shouldAttemptFinancialEmailTypeVerification(candidate);
  const repairDate = needsOperationDate(candidate);
  const typeAttempt = (status: BillEventVerification["status"]) => ({
    ...metadata(status, providerId, model),
    attempted_at: new Date().toISOString(),
    attempts: (candidate.type_verification?.attempts ?? (candidate.type_verification ? 1 : 0)) + 1,
  });

  const prompt = `Audit the semantic event classification for this bill or financial email.

Return a corrected extraction using the required schema. Focus on document_role, event_kind, event_confidence, event_evidence, due_date, type, type_confidence, type_evidence, account_hint, from_account_hint, to_account_hint, settlement_kind, and provider_reference with their evidence/confidences. Check event/type consistency independently of the first-pass confidence. Preserve the original monetary evidence; this audit does not select Actual IDs. Repair due_date when the email contains an explicit date for the classified event, including when correcting an event whose existing date belongs to a different event.
Preserve a supported merchant_receipt role when the sender is the seller or merchant of record, even if it also offers checkout or payment services. Change it to processor_receipt only when the document records funding or payment to a separate seller. Repairing a date does not itself justify changing the document role.
${BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS}

Event definitions:
- statement_issued: a newly available credit or financial statement
- payment_due: a due-date or payment-due reminder
- payment_scheduled: upcoming autopay or a payment scheduled for a future date
- account_transfer_pending: a bank or wallet transfer that was requested, initiated, or is still processing
- account_transfer_completed: a bank or wallet transfer confirmed complete
- card_payment_completed: a payment posted or applied to a credit-card/account balance; this is a transfer
- payment_completed: a completed utility or merchant bill payment
- payment_cancelled: autopay or a payment was cancelled; body cancellation language overrides a stale scheduled subject
- purchase: a charge, order, authorization, transaction, or receipt
- refund: a refund, reversal, or account credit
- bill_issued: a recurring-service invoice or utility bill
- reward: cashback or reward income
- payment_failed: a declined, returned, or failed payment
- other: only when none of the above applies

The absence of a numeric amount does not make an event "other". Use the subject and explicit event wording. Do not change classification merely because the message says no action is required.

First-pass event:
${JSON.stringify({
    document_role: candidate.document_role ?? null,
    event_kind: candidate.event_kind ?? null,
    event_confidence: candidate.event_confidence ?? null,
    event_evidence: candidate.event_evidence ?? null,
    type: candidate.type ?? null,
    type_confidence: candidate.type_confidence ?? null,
    type_evidence: candidate.type_evidence ?? null,
    account_hint: candidate.account_hint ?? null,
    from_account_hint: candidate.from_account_hint ?? null,
    to_account_hint: candidate.to_account_hint ?? null,
    settlement_kind: candidate.settlement_kind ?? null,
    settlement_evidence: candidate.settlement_evidence ?? null,
    provider_reference: candidate.provider_reference ?? null,
    provider_reference_evidence: candidate.provider_reference_evidence ?? null,
    due_date: candidate.due_date ?? null,
  })}`;

  try {
    const verified = await provider.extract({ model, systemPrompt: prompt, content, usagePurpose: "verification" });
    let eventAccepted = usableEvent(verified.fields, content);
    let typeAccepted = hasStrongFinancialType(verified.fields)
      && hasVerbatimFinancialEvidence(content, verified.fields.type_evidence);
    const semanticsAccepted = !hasFinancialSemanticConflict({
      ...candidate,
      ...(eventAccepted ? { event_kind: verified.fields.event_kind } : {}),
      ...(typeAccepted ? { type: verified.fields.type } : {}),
    });
    eventAccepted = eventAccepted && semanticsAccepted;
    typeAccepted = typeAccepted && semanticsAccepted;
    const dateAccepted = eventAccepted
      && hasExplicitDateForYmd(content, verified.fields.due_date);
    const eventChanged = eventAccepted && verified.fields.event_kind !== candidate.event_kind;
    const roleAccepted = semanticsAccepted && ["merchant_receipt", "processor_receipt", "bank_notification", "statement", "payment_notice", "other"].includes(String(verified.fields.document_role));
    const accountAccepted = semanticsAccepted && Number(verified.fields.account_hint_confidence) >= 0.8
      && Number(verified.fields.account_hint_confidence) <= 1
      && hasVerbatimFinancialEvidence(content, verified.fields.account_hint);
    const fromAccountAccepted = semanticsAccepted && Number(verified.fields.from_account_hint_confidence) >= 0.8
      && Number(verified.fields.from_account_hint_confidence) <= 1
      && hasVerbatimFinancialEvidence(content, verified.fields.from_account_hint);
    const toAccountAccepted = semanticsAccepted && Number(verified.fields.to_account_hint_confidence) >= 0.8
      && Number(verified.fields.to_account_hint_confidence) <= 1
      && hasVerbatimFinancialEvidence(content, verified.fields.to_account_hint);
    const settlementAccepted = semanticsAccepted && Number(verified.fields.settlement_confidence) >= 0.8
      && Number(verified.fields.settlement_confidence) <= 1
      && Boolean(verified.fields.settlement_kind)
      && hasVerbatimFinancialEvidence(content, verified.fields.settlement_evidence);
    const providerReferenceAccepted = semanticsAccepted && Number(verified.fields.provider_reference_confidence) >= 0.8
      && Number(verified.fields.provider_reference_confidence) <= 1
      && hasVerbatimFinancialEvidence(content, verified.fields.provider_reference)
      && hasVerbatimFinancialEvidence(content, verified.fields.provider_reference_evidence);
    return {
      candidate: {
        ...candidate,
        ...(roleAccepted ? { document_role: verified.fields.document_role } : {}),
        ...(verifyType ? { type_verification: typeAttempt(typeAccepted ? "corrected" : "kept_initial") } : {}),
        ...(typeAccepted
          ? {
              type: verified.fields.type,
              type_confidence: verified.fields.type_confidence,
              type_evidence: verified.fields.type_evidence,
            }
          : {}),
        ...(accountAccepted
          ? {
              account_hint: verified.fields.account_hint,
              account_hint_confidence: verified.fields.account_hint_confidence,
            }
          : {}),
        ...(fromAccountAccepted
          ? {
              from_account_hint: verified.fields.from_account_hint,
              from_account_hint_confidence: verified.fields.from_account_hint_confidence,
            }
          : {}),
        ...(toAccountAccepted
          ? {
              to_account_hint: verified.fields.to_account_hint,
              to_account_hint_confidence: verified.fields.to_account_hint_confidence,
            }
          : {}),
        ...(settlementAccepted
          ? {
              settlement_kind: verified.fields.settlement_kind,
              settlement_confidence: verified.fields.settlement_confidence,
              settlement_evidence: verified.fields.settlement_evidence,
            }
          : {}),
        ...(providerReferenceAccepted
          ? {
              provider_reference: verified.fields.provider_reference,
              provider_reference_confidence: verified.fields.provider_reference_confidence,
              provider_reference_evidence: verified.fields.provider_reference_evidence,
            }
          : {}),
        ...(eventAccepted ? {
          event_kind: verified.fields.event_kind,
          event_confidence: verified.fields.event_confidence,
          event_evidence: verified.fields.event_evidence,
        } : {}),
        ...(repairDate || eventChanged ? { due_date: dateAccepted ? verified.fields.due_date : null } : {}),
        event_verification: metadata(eventAccepted ? "corrected" : "kept_initial", providerId, model),
      },
      usage: verified.usage || {},
    };
  } catch {
    return {
      candidate: { ...candidate, event_verification: metadata("failed", providerId, model), ...(verifyType ? { type_verification: typeAttempt("failed") } : {}) },
      usage: {},
    };
  }
}
