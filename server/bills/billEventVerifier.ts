import { BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS } from "./bill-semantic-prompt.ts";
import { hasStrongFinancialType, hasVerbatimFinancialEvidence, shouldAttemptFinancialEmailTypeVerification } from "./financialEmailClassificationPolicy.ts";
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

export function shouldVerifyBillEvent(candidate: BillCandidate): boolean {
  return !candidate.event_kind
    || candidate.event_kind === "other"
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
  const typeAttempt = (status: BillEventVerification["status"]) => ({
    ...metadata(status, providerId, model),
    attempted_at: new Date().toISOString(),
    attempts: (candidate.type_verification?.attempts ?? (candidate.type_verification ? 1 : 0)) + 1,
  });

  const prompt = `Audit the semantic event classification for this bill or financial email.

Return a corrected extraction using the required schema. Focus on event_kind, event_confidence, event_evidence, type, type_confidence, type_evidence, account_hint, and account_hint_confidence. Preserve the original amount and date; this audit does not select Actual IDs.
${BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS}

Event definitions:
- statement_issued: a newly available credit or financial statement
- payment_due: a due-date or payment-due reminder
- payment_scheduled: upcoming autopay or a payment scheduled for a future date
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
    event_kind: candidate.event_kind ?? null,
    event_confidence: candidate.event_confidence ?? null,
    event_evidence: candidate.event_evidence ?? null,
    type: candidate.type ?? null,
    type_confidence: candidate.type_confidence ?? null,
    type_evidence: candidate.type_evidence ?? null,
    account_hint: candidate.account_hint ?? null,
  })}`;

  try {
    const verified = await provider.extract({ model, systemPrompt: prompt, content });
    const eventAccepted = usableEvent(verified.fields, content);
    const typeAccepted = hasStrongFinancialType(verified.fields)
      && hasVerbatimFinancialEvidence(content, verified.fields.type_evidence);
    const accountAccepted = Number(verified.fields.account_hint_confidence) >= 0.8
      && Number(verified.fields.account_hint_confidence) <= 1
      && hasVerbatimFinancialEvidence(content, verified.fields.account_hint);
    return {
      candidate: {
        ...candidate,
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
        ...(eventAccepted ? {
          event_kind: verified.fields.event_kind,
          event_confidence: verified.fields.event_confidence,
          event_evidence: verified.fields.event_evidence,
        } : {}),
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
