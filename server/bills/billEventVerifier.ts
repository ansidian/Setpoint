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
    || (Boolean(candidate.event_kind) && Number(candidate.event_confidence) < 0.8);
}

function metadata(
  status: BillEventVerification["status"],
  provider: string,
  model: string,
): BillEventVerification {
  return { status, provider, model };
}

function usableEvent(candidate: BillCandidate): boolean {
  return Boolean(
    candidate.event_kind
    && candidate.event_kind !== "other"
    && BILL_EVENT_KINDS.includes(candidate.event_kind)
    && Number(candidate.event_confidence) >= 0.7
    && String(candidate.event_evidence || "").trim(),
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

  const prompt = `Audit the semantic event classification for this bill or financial email.

Return a corrected extraction using the required schema. Focus only on event_kind, event_confidence, and event_evidence:
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
  })}`;

  try {
    const verified = await provider.extract({ model, systemPrompt: prompt, content });
    if (!usableEvent(verified.fields)) {
      return {
        candidate: { ...candidate, event_verification: metadata("kept_initial", providerId, model) },
        usage: verified.usage || {},
      };
    }
    return {
      candidate: {
        ...candidate,
        event_kind: verified.fields.event_kind,
        event_confidence: verified.fields.event_confidence,
        event_evidence: verified.fields.event_evidence,
        event_verification: metadata("corrected", providerId, model),
      },
      usage: verified.usage || {},
    };
  } catch {
    return {
      candidate: { ...candidate, event_verification: metadata("failed", providerId, model) },
      usage: {},
    };
  }
}
