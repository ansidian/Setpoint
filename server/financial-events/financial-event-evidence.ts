import { createHash } from "node:crypto";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { FinancialEventCompletionEntry } from "../../shared/types/financial-operations.ts";
import { selectSemanticBillAmount } from "../bills/financial-email-planner.ts";

/** A document is evidence. Its provider identity is never the identity of a ledger write. */
export interface FinancialEvidenceDocument {
  emailUid: string;
  fromName?: string;
  fromAddress: string;
  subject: string;
  body: string;
  emailDate: string;
  eventId: string | null;
  candidate: BillCandidate | null;
  senderAuthentication: { status: string } | null;
  ownerConfirmedEntry?: FinancialEventCompletionEntry | null;
}

/** Human-confirmed identity facts aid correlation without rewriting extraction or authentication. */
function correlationCandidate(document: FinancialEvidenceDocument): BillCandidate | null {
  const entry = document.ownerConfirmedEntry;
  if (!entry) return document.candidate;
  return { ...document.candidate, type: entry.kind === "transfer_schedule" ? "transfer" : entry.kind,
    event_kind: entry.kind === "expense" ? "purchase" : entry.kind === "income" ? "payment_completed"
      : entry.kind === "bill" ? "bill_issued" : entry.kind === "transfer" ? "account_transfer_completed" : "payment_scheduled",
    amount: entry.amount, amount_kind: "transaction_amount", amount_candidates: undefined, amount_verification: undefined,
    account_hint: undefined, account_hint_confidence: undefined, account_last4: undefined,
    account_last4_evidence: undefined, account_last4_confidence: undefined,
    due_date: entry.date, currency: "USD", payee: entry.payee, payee_hint: entry.payee,
  };
}

function text(value: unknown): string {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function financialDocumentContentHash(document: FinancialEvidenceDocument): string {
  return createHash("sha256").update(JSON.stringify([
    document.fromName, document.fromAddress, document.subject, document.body, document.emailDate,
  ])).digest("hex");
}

function family(candidate: BillCandidate): string {
  if (candidate.type === "income" || ["refund", "reward"].includes(String(candidate.event_kind))) return "income";
  if (candidate.type === "transfer") {
    return ["card_payment_completed", "account_transfer_completed"].includes(String(candidate.event_kind))
      ? "completed_transfer" : "transfer_obligation";
  }
  if (["statement_issued", "payment_due", "payment_scheduled", "bill_issued"].includes(String(candidate.event_kind))) return "obligation";
  return "expense";
}

function providerReference(document: FinancialEvidenceDocument): string | null {
  const candidate = document.candidate;
  const reference = text(candidate?.provider_reference);
  if (!reference || Number(candidate?.provider_reference_confidence) < 0.8
    || !text(candidate?.provider_reference_evidence).includes(reference)
    || !text(`${document.subject}\n${document.body}`).includes(reference)) return null;
  return `${document.fromAddress.toLowerCase()}\u001f${reference.toLowerCase()}`;
}

export function financialDocumentReferenceKey(document: FinancialEvidenceDocument): string | null {
  const reference = providerReference(document);
  return reference && document.candidate ? createHash("sha256")
    .update(JSON.stringify([family(document.candidate), reference])).digest("hex") : null;
}

function sameProvenReference(left: FinancialEvidenceDocument, right: FinancialEvidenceDocument): boolean {
  const reference = providerReference(left);
  return !!reference && reference === providerReference(right);
}

function merchant(candidate: BillCandidate): string {
  return text(candidate.payee_hint || candidate.payee).toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter((part) => part && !["inc", "llc", "ltd", "co", "corp", "usa", "us", "com", "the"].includes(part)).join(" ");
}

function amount(candidate: BillCandidate): number | null {
  const selected = selectSemanticBillAmount(candidate);
  return selected && selected.amount > 0 ? Math.round(selected.amount * 100) : null;
}

function complementaryReceipt(left: FinancialEvidenceDocument, right: FinancialEvidenceDocument): boolean {
  const a = correlationCandidate(left)!;
  const b = correlationCandidate(right)!;
  const roles = new Set([a.document_role, b.document_role]);
  const near = Math.abs(Date.parse(left.emailDate) - Date.parse(right.emailDate)) <= 5 * 60_000;
  // Cross-provider references are unrelated namespaces. Complementary source roles,
  // exact merchant/amount/date and uniqueness in BOTH directions are required.
  return left.fromAddress.toLowerCase() !== right.fromAddress.toLowerCase()
    && roles.has("merchant_receipt") && (roles.has("processor_receipt") || roles.has("bank_notification"))
    && (!!left.ownerConfirmedEntry || left.senderAuthentication?.status === "pass")
    && (!!right.ownerConfirmedEntry || right.senderAuthentication?.status === "pass")
    && a.event_kind === "purchase" && b.event_kind === "purchase"
    && !!merchant(a) && merchant(a) === merchant(b)
    && amount(a) !== null && amount(a) === amount(b)
    && a.currency === b.currency && !!a.due_date && a.due_date === b.due_date && near
    && (!a.account_last4 || !b.account_last4 || a.account_last4 === b.account_last4);
}

export function correlateFinancialDocument(
  document: FinancialEvidenceDocument,
  documents: FinancialEvidenceDocument[],
): { eventId: string | null; ambiguous: boolean } {
  if (document.eventId) return { eventId: document.eventId, ambiguous: false };
  const candidate = correlationCandidate(document);
  if (!candidate) return { eventId: null, ambiguous: false };
  const others = documents.filter((other) => other.emailUid !== document.emailUid && correlationCandidate(other)
    && (other.ownerConfirmedEntry || other.senderAuthentication?.status === "pass"));
  const sameFamily = others.filter((other) => family(correlationCandidate(other)!) === family(candidate));
  const reference = providerReference(document);
  const exact = reference ? sameFamily.filter((other) => providerReference(other) === reference) : [];
  if (exact.length) {
    const eventIds = [...new Set(exact.map((other) => other.eventId).filter((id): id is string => !!id))];
    return { eventId: eventIds.length === 1 ? eventIds[0]! : null, ambiguous: eventIds.length !== 1 };
  }
  const matches = sameFamily.filter((other) => complementaryReceipt(document, other));
  if (!matches.length) return { eventId: null, ambiguous: false };
  const eventIds = [...new Set(matches.map((other) => other.eventId).filter((id): id is string => !!id))];
  const inverse = matches.some((other) => others.some((competitor) => (
    competitor.emailUid !== other.emailUid && complementaryReceipt(competitor, other)
    && !sameProvenReference(competitor, document)
  )));
  if (eventIds.length !== 1 || inverse) return { eventId: null, ambiguous: true };
  const eventId = eventIds[0]!;
  // A second processor/merchant receipt with a different reference represents a
  // separate purchase even if its amount and arrival time happen to coincide.
  const sameRole = others.some((other) => other.eventId === eventId
    && correlationCandidate(other)!.document_role === candidate.document_role
    && !sameProvenReference(other, document));
  return { eventId: sameRole ? null : eventId, ambiguous: sameRole };
}

/** Merge only authenticated, compatible facts; keep a conflict visible instead of choosing a winner. */
export function combineFinancialEventEvidence(documents: FinancialEvidenceDocument[]): {
  candidate: BillCandidate | null;
  body: string;
  authenticated: boolean;
  conflict: boolean;
} {
  const usable = documents.filter((document) => document.candidate && document.senderAuthentication?.status === "pass");
  const candidates = usable.map((document) => document.candidate!);
  if (!candidates.length) return { candidate: null, body: "", authenticated: false, conflict: false };
  const unique = (values: unknown[]) => [...new Set(values.map(text).filter(Boolean))];
  const financialFamily = unique(candidates.map(family));
  const amounts = unique(candidates.map(amount));
  const dates = unique(candidates.map((candidate) => candidate.due_date));
  const currencies = unique(candidates.map((candidate) => candidate.currency));
  const suffixes = unique(candidates.map((candidate) => candidate.account_last4));
  const conflictingHints = ["account_hint", "from_account_hint", "to_account_hint", "settlement_kind"]
    .some((field) => unique(candidates.map((candidate) => text(candidate[field]).toLowerCase())).length > 1);
  const merchants = unique(candidates.map(merchant));
  const conflict = financialFamily.length > 1 || amounts.length > 1 || dates.length > 1 || currencies.length > 1
    || suffixes.length > 1 || conflictingHints || merchants.length > 1;
  const base = [...candidates].sort((a, b) => Number(!!b.account_hint || !!b.account_last4) - Number(!!a.account_hint || !!a.account_last4))[0]!;
  const candidate = { ...base };
  if (amount(candidate) === null) {
    const completeAmount = candidates.find((item) => amount(item) !== null);
    if (completeAmount) {
      candidate.amount = completeAmount.amount;
      candidate.amount_kind = completeAmount.amount_kind;
      candidate.amount_candidates = completeAmount.amount_candidates;
      candidate.amount_verification = completeAmount.amount_verification;
    }
  }
  const factPairs: Array<[keyof BillCandidate, Array<keyof BillCandidate>]> = [
    ["account_hint", ["account_hint_confidence"]],
    ["account_last4", ["account_last4_evidence", "account_last4_confidence"]],
    ["from_account_hint", ["from_account_hint_confidence"]],
    ["to_account_hint", ["to_account_hint_confidence"]],
    ["due_date", []], ["currency", []], ["payee_hint", []],
    ["settlement_kind", ["settlement_evidence", "settlement_confidence"]],
  ];
  for (const [key, evidenceKeys] of factPairs) {
    if (candidate[key]) continue;
    const source = candidates.find((item) => item[key]);
    if (source) for (const field of [key, ...evidenceKeys]) candidate[field] = source[field];
  }
  // A failed audit must still see the original rows, competing amounts and
  // cancellation language. Extracted quotes cannot replace complete sources.
  // The planner's existing evidence limit rejects oversized groups visibly.
  const body = usable.map((document) =>
    `From: ${document.fromAddress}\nSubject: ${document.subject}\n\n${document.body}`,
  ).join("\n\n--- Related source document ---\n\n");
  return { candidate, body, authenticated: true, conflict };
}

/** A verified old write is never evidence that changed source facts are correct. */
export function financialEvidenceChangedAfterAttempt(candidate: BillCandidate | null, admitted: BillCandidate | null): boolean {
  if (!candidate || !admitted) return true;
  if (family(candidate) !== family(admitted) || candidate.event_kind !== admitted.event_kind) return true;
  if (merchant(candidate) && merchant(admitted) && merchant(candidate) !== merchant(admitted)) return true;
  const normalize = (value: unknown) => text(value).toLowerCase();
  return ["due_date", "currency", "account_last4", "account_hint", "from_account_hint", "to_account_hint", "settlement_kind"]
    .some((field) => candidate[field] && admitted[field] && normalize(candidate[field]) !== normalize(admitted[field]))
    || (amount(candidate) !== null && amount(admitted) !== null && amount(candidate) !== amount(admitted));
}
