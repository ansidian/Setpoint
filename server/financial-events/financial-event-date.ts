import type { BillCandidate } from "../../shared/types/bills.ts";
import { hasExplicitDateForYmd, hasStrongFinancialType, hasVerbatimFinancialEvidence } from "../bills/financial-email-planner.ts";
import type { FinancialEvidenceDocument } from "./financial-event-evidence.ts";

const TIME_ZONE = "America/Los_Angeles";

/** Interpret an authenticated initial confirmation's original email timestamp.
 * The model classifies timing; only this policy assigns a fallback ledger date. */
export function resolveFinancialDocumentDate(document: FinancialEvidenceDocument, now = new Date()): BillCandidate | null {
  if (!document.candidate) return null;
  const candidate = { ...document.candidate };
  // Recompute derived dates from this source, including after timestamp changes.
  // Persisted/model-supplied provenance cannot authorize a date on its own.
  if (candidate.operation_date_source) {
    candidate.due_date = null;
    delete candidate.operation_date_source;
  }
  if (candidate.due_date) return candidate;
  const context = candidate.purchase_date_context;
  const content = `${document.subject}\n${document.body}`;
  if (document.senderAuthentication?.status !== "pass" || candidate.event_kind !== "purchase" || candidate.type !== "expense"
    || !["merchant_receipt", "processor_receipt"].includes(String(candidate.document_role))
    || [candidate.event_verification, candidate.type_verification].some((verification) => verification?.status === "failed")
    || !hasStrongFinancialType(candidate) || !hasVerbatimFinancialEvidence(content, candidate.type_evidence)
    || !(Number(candidate.event_confidence) >= 0.9 && Number(candidate.event_confidence) <= 1)
    || !hasVerbatimFinancialEvidence(content, candidate.event_evidence)
    || context?.kind !== "initial_confirmation_without_date" || !(context.confidence >= 0.9 && context.confidence <= 1)
    || !hasVerbatimFinancialEvidence(content, context.evidence)) return candidate;
  const timestamp = new Date(document.emailDate);
  if (!Number.isFinite(timestamp.getTime())
    || timestamp.toISOString().replace(".000Z", "Z") !== document.emailDate.replace(".000Z", "Z")) return candidate;
  const date = timestamp.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
  if (date > now.toLocaleDateString("en-CA", { timeZone: TIME_ZONE })) return candidate;
  return { ...candidate, due_date: date, operation_date_source: {
    kind: "email_date", emailUid: document.emailUid, emailDate: document.emailDate,
    timeZone: TIME_ZONE, date, evidence: context.evidence,
  } };
}

/** Both document assessment and immutable write admission use the same proof. */
export function financialDocumentSupportsDate(document: FinancialEvidenceDocument, planned: BillCandidate, now = new Date()): boolean {
  if (hasExplicitDateForYmd(`${document.subject}\n${document.body}`, planned.due_date)) return true;
  const candidate = resolveFinancialDocumentDate(document, now);
  const revalidated = resolveFinancialDocumentDate({ ...document, candidate: planned }, now);
  return !!candidate?.operation_date_source && !!revalidated?.operation_date_source
    && candidate.due_date === planned.due_date && revalidated.due_date === planned.due_date;
}
