// Shared by triage and both manual-extraction providers so semantic identity
// remains available before Actual account resolution.
import { FINANCIAL_SETTLEMENT_KINDS } from "../../shared/types/bills.ts";

export const BILL_SEMANTIC_IDENTITY_PROPERTIES = {
  type: { type: ["string", "null"], enum: ["transfer", "bill", "expense", "income", null] },
  type_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  type_evidence: { type: ["string", "null"] },
  account_hint: { type: ["string", "null"] },
  account_hint_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  from_account_hint: { type: ["string", "null"] },
  from_account_hint_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  to_account_hint: { type: ["string", "null"] },
  to_account_hint_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  settlement_kind: { type: ["string", "null"], enum: [...FINANCIAL_SETTLEMENT_KINDS, null] },
  settlement_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  settlement_evidence: { type: ["string", "null"] },
  provider_reference: { type: ["string", "null"] },
  provider_reference_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  provider_reference_evidence: { type: ["string", "null"] },
};
export const BILL_SEMANTIC_IDENTITY_REQUIRED = Object.keys(BILL_SEMANTIC_IDENTITY_PROPERTIES);
export const FINANCIAL_CANDIDATE_SEMANTICS_VERSION = 2;

export const BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS: string = `For each bill candidate:
- Classify event_kind as statement_issued for a newly available credit/financial statement; payment_due for a due reminder; payment_scheduled for upcoming or scheduled autopay toward a bill or credit-card balance; account_transfer_pending for a bank/wallet account transfer that was requested, initiated, or is processing but not complete; account_transfer_completed for a bank/wallet account transfer confirmed complete; card_payment_completed when a payment was posted or applied to a credit-card/account balance; payment_completed for a completed utility or merchant bill payment; payment_cancelled when autopay or a payment was cancelled; purchase for a charge, order, authorization, or receipt; refund for a refund or account credit; bill_issued for a recurring-service invoice or utility bill; reward for cashback/reward income; payment_failed for a declined, returned, or failed payment; other only when none applies. A cancellation in the body overrides scheduled wording in the subject.
- Classify type from the ledger meaning of the email: transfer for either a payment toward a credit-card balance or a bank/wallet movement between represented accounts; bill for a recurring utility/service bill or its payment; expense for a one-off purchase/payment; income for a refund, reward, or money arriving from an external balance. Paying a merchant with a card is an expense, not a transfer. For this owner, PayPal balance is external to Actual: a PayPal-balance-to-bank movement is income and defaults to cashback/reward unless the email explicitly establishes another source. If the payment purpose is unknown or ambiguous, return null type rather than defaulting to bill.
- Return type_confidence from 0 to 1 and one short contiguous verbatim type_evidence excerpt establishing that meaning. Copy the excerpt directly without quotation delimiters, ellipses, paraphrases, or joining separate quotes. Identify a credit-card payment even when its card suffix or Actual account is unknown; type must never depend on resolving an Actual ID.
- Return account_hint as a short verbatim card/account product name identifying the account involved, with account_hint_confidence from 0 to 1; otherwise return both as null. For a credit-card payment, this is the destination card being paid. Preserve the precise card product name separately from an issuer name; never concatenate names or invent a suffix. Generic payment wording cannot identify the funding account. Do not use a card-network name alone to infer an Actual account.
- For account_transfer_pending or account_transfer_completed, return separate short contiguous verbatim from_account_hint and to_account_hint excerpts with confidences from 0 to 1. Use only descriptions that establish the source and destination sides of that transfer, such as "PayPal balance" and "EXAMPLE BANK x-0001". Return each unavailable side and its confidence as null. Do not put a general account transfer's destination in account_hint, which is reserved for card/account product identity.
- Return settlement_kind as statement_credit when income is applied directly to a card/account balance, bank_deposit when reward cash is deposited into a bank account, or balance_to_bank when money moves from a third-party stored balance into a bank account. Return a short contiguous verbatim settlement_evidence excerpt and confidence; otherwise return all three as null. In this owner's Chase cash-back notices, an Order number beginning SC is statement-credit evidence and one beginning CB is bank-deposit evidence; preserve the complete order number as the evidence.
- Return provider_reference as the complete provider-issued transaction, transfer, confirmation, or order identifier, plus a short contiguous verbatim provider_reference_evidence excerpt and confidence. Prefer labels such as Transaction ID or Order number. Return all three as null when no stable provider reference is present; never invent or truncate an identifier.
- Return event_confidence from 0 to 1 and short verbatim event_evidence.
- Return currency as the ISO currency code evidenced by the canonical amount (USD for a dollar amount identified as US dollars, including an unqualified $ in a US account/merchant context). Return null when currency is unknown or ambiguous; never convert a non-USD amount to USD.
- due_date is the operation date in YYYY-MM-DD, not always a future bill deadline. For purchase, payment_completed, card_payment_completed, account_transfer_completed, refund, reward, or other completed income, use the explicit transaction, purchase, order, redemption, paid, posted, credited, or completion date for that event. For statements, due reminders, and recurring bills use the explicit payment due date; for payment_scheduled use the explicit scheduled payment date; for account_transfer_pending use the explicit request or initiation date when present.
- Include the supporting verbatim date text in event_evidence. If the operation date is absent, ambiguous, or lacks an unambiguous year, return null due_date. Never substitute the email received date, today's date, a statement period boundary, shipping/delivery date, or a different event's date. A completed transaction date does not create an Inbox deadline_at; that field remains reserved for an actual deadline requiring action.
- When an explicit account/card suffix is present, return account_last4 as exactly four digits, short verbatim account_last4_evidence, and account_last4_confidence from 0 to 1. Otherwise return all three as null.
- Set target_policy_key, target_confidence, and target_evidence to null. Target policy selection is a separate constrained audit; never invent an Actual ID, mapping, or target policy.
- Preserve every distinct labeled monetary value in amount_candidates with its semantic kind, short verbatim evidence, and confidence. Distinguish statement_balance, minimum_due, total_due, payment_amount, transaction_amount, refund_amount, order_total, subtotal, and other.
- Associate labels with nearby values even when email layout puts them on following lines.
- Set amount_kind to the canonical amount for this document and amount to that candidate's value. A statement balance is canonical whenever present.
- Preserve minimum_due only as an informational amount_candidate; never select minimum_due as amount_kind or use its value as amount.
- If no non-minimum canonical amount is present, return null amount and null amount_kind.`;
