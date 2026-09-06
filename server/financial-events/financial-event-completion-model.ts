import type { FinancialEventCompletionEntry, FinancialEventCompletionRequest } from "../../shared/types/financial-operations.ts";
import type { BillCandidate, FinancialEmailPlan, FinancialPlanTarget, FinancialTargetKind } from "../../shared/types/bills.ts";
import type { FinancialDocument, FinancialEvent } from "./financial-event-store.ts";
import type { FinancialEventOperation } from "./financial-event-operation.ts";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import { financialDocumentContentHash, financialEvidenceChangedAfterAttempt } from "./financial-event-evidence.ts";
import { accountSuffix, hasVerbatimFinancialEvidence, namedAccountEvidence, trustedAccountSuffix } from "../bills/financial-email-planner.ts";

export interface FinancialOwnerCompletion {
  version: 1;
  id: string;
  submittedAt: number;
  entry: FinancialEventCompletionEntry;
  documents: Array<{ emailUid: string; revision: number; contentHash: string; candidate: BillCandidate | null }>;
}

function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid("Financial completion details are required");
}
function string(value: unknown, name: string, max: number, required = false): string | undefined {
  if (value == null || value === "") return required ? invalid(`${name} is required`) : undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max) return invalid(`${name} is invalid`);
  return value.trim();
}

export function parseFinancialEventCompletion(value: unknown): FinancialEventCompletionRequest {
  const request = object(value);
  const source = object(request.entry);
  const emailUid = string(request.emailUid, "Email UID", 500, true)!;
  if (!Number.isInteger(request.documentRevision) || Number(request.documentRevision) < 1
    || !(request.eventRevision === null || Number.isInteger(request.eventRevision) && Number(request.eventRevision) > 0)) invalid("Refresh this email before completing the entry");
  const kind = source.kind as FinancialEventCompletionEntry["kind"];
  if (!["expense", "income", "bill", "transfer", "transfer_schedule"].includes(kind)) invalid("Entry kind is invalid");
  const cents = typeof source.amount === "number" ? Math.round(source.amount * 100) : NaN;
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(Number(source.amount) * 100 - cents) > 0.000001) invalid("Amount must be positive USD with at most two decimal places");
  const date = string(source.date, "Date", 10, true)!;
  const parsedDate = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) invalid("Date must be a valid YYYY-MM-DD date");
  const notes = string(source.notes, "Notes", 2000);
  const scheduleName = string(source.scheduleName, "Schedule name", 200);
  const transfer = kind === "transfer" || kind === "transfer_schedule";
  let entry: FinancialEventCompletionEntry;
  if (transfer) {
    const fromAccountId = string(source.fromAccountId, "Source account", 200, true)!;
    const toAccountId = string(source.toAccountId, "Destination account", 200, true)!;
    if (fromAccountId === toAccountId) invalid("Choose two different transfer accounts");
    entry = { kind, amount: cents / 100, date, fromAccountId, toAccountId, ...(notes ? { notes } : {}), ...(scheduleName ? { scheduleName } : {}) };
  } else {
    const accountId = string(source.accountId, "Account", 200, true)!;
    const payee = string(source.payee, "Payee", 200, true)!;
    const categoryId = string(source.categoryId, "Category", 200) || null;
    entry = { kind, amount: cents / 100, date, accountId, payee, categoryId, ...(notes ? { notes } : {}), ...(scheduleName ? { scheduleName } : {}) };
  }
  return { emailUid, documentRevision: Number(request.documentRevision), eventRevision: request.eventRevision as number | null, entry };
}

export function completionBlocker(event: Pick<FinancialEvent, "attemptedAt" | "operation" | "outcome" | "plan" | "ownerCompletion" | "status"> | null): string | null {
  if (event?.attemptedAt != null || event?.operation) return "This entry has already been submitted to Actual and cannot be submitted again.";
  if (["added", "updated", "already_present"].includes(String((event?.outcome as { outcome?: unknown } | null)?.outcome))
    || ["already_recorded", "already_scheduled"].includes(String(event?.plan?.reconciliation.status))) return "This event is already recorded in Actual.";
  if (event?.ownerCompletion && ["pending", "processing"].includes(event.status)) return "Your confirmed entry is already queued for Actual.";
  return null;
}

export function ownerCompletionSnapshot(entry: FinancialEventCompletionEntry, documents: FinancialDocument[], now: number, id: string): FinancialOwnerCompletion {
  return { version: 1, id, submittedAt: now, entry, documents: documents.map((document) => ({
    emailUid: document.emailUid, revision: document.revision, contentHash: financialDocumentContentHash(document), candidate: document.candidate,
  })) };
}

function newCompletionDocuments(event: FinancialEvent): FinancialDocument[] {
  const original = new Set(event.ownerCompletion?.documents.map((document) => document.emailUid));
  return event.documents.filter((document) => !original.has(document.emailUid));
}

export function ownerCompletionNeedsAccountEvidence(event: FinancialEvent): boolean {
  return newCompletionDocuments(event).some((document) => ["account_hint", "account_last4", "from_account_hint", "to_account_hint"]
    .some((field) => !!document.candidate?.[field]));
}

function accountEvidenceChanged(document: FinancialDocument, entry: FinancialEventCompletionEntry, metadata?: ActualMetadata | null): boolean {
  const candidate = document.candidate;
  if (!candidate) return false;
  const content = `${document.subject}\n${document.body}`;
  const transfer = entry.kind === "transfer" || entry.kind === "transfer_schedule";
  const primaryAccountId = transfer ? entry.toAccountId : entry.accountId;
  const roles: Array<["account" | "from_account" | "to_account", string | undefined]> = transfer
    ? [["account", primaryAccountId], ["from_account", entry.fromAccountId], ["to_account", entry.toAccountId]]
    : [["account", primaryAccountId], [entry.kind === "income" ? "to_account" : "from_account", primaryAccountId]];
  for (const [role, expectedId] of roles) {
    if (!candidate[`${role}_hint`]) continue;
    if (!metadata || !expectedId) return true;
    const matches = namedAccountEvidence(candidate, metadata, role, content);
    if (matches.length !== 1 || matches[0]!.id !== expectedId) return true;
  }
  if (!candidate.account_last4) return false;
  const suffix = trustedAccountSuffix(candidate);
  if (!metadata || !suffix || !hasVerbatimFinancialEvidence(content, candidate.account_last4_evidence)) return true;
  const matches = metadata.accounts.filter((account) => !account.closed && accountSuffix(account.name) === suffix);
  return matches.length !== 1 || matches[0]!.id !== primaryAccountId;
}

export function ownerCompletionSourceChanged(event: FinancialEvent, metadata?: ActualMetadata | null): boolean {
  const original = new Map(event.ownerCompletion?.documents.map((document) => [document.emailUid, document.contentHash]) || []);
  const entry = event.ownerCompletion?.entry;
  if (!entry) return false;
  const admitted = ownerCompletionPlan(event.id, entry).candidate;
  return event.documents.some((document) => {
    if (document.ownerConfirmationConflict) return true;
    if (original.has(document.emailUid)) return original.get(document.emailUid) !== financialDocumentContentHash(document);
    const candidate = document.candidate;
    // Confirmation selects a ledger operation. Equivalent source subtypes can
    // support it, while pending, scheduled and completed movement stay distinct.
    const sameIncome = entry.kind === "income" && candidate?.type === "income"
      && ["payment_completed", "account_transfer_completed", "refund", "reward"].includes(String(candidate.event_kind));
    const sameTransfer = entry.kind === "transfer" && candidate?.type === "transfer"
      && ["card_payment_completed", "account_transfer_completed"].includes(String(candidate.event_kind));
    const sameExpense = entry.kind === "expense" && candidate?.type === "expense"
      && ["purchase", "payment_completed"].includes(String(candidate.event_kind));
    const sameBill = entry.kind === "bill" && candidate?.type === "bill"
      && ["bill_issued", "payment_due", "statement_issued"].includes(String(candidate.event_kind));
    const comparable = sameIncome || sameTransfer || sameExpense || sameBill
      ? { ...candidate, event_kind: admitted.event_kind } : candidate;
    return document.senderAuthentication?.status !== "pass" || financialEvidenceChangedAfterAttempt(comparable, admitted)
      || accountEvidenceChanged(document, entry, metadata);
  });
}

function target(kind: FinancialTargetKind, id?: string | null, label?: string): FinancialPlanTarget {
  return { kind, status: id || label ? "resolved" : "not_applicable", id: id || null, label: label || id || null,
    provenance: id || label ? [{ source: "source_adapter", confidence: "exact", reason: "Confirmed by the owner." }] : [] };
}

export function ownerCompletionPlan(eventId: string, entry: FinancialEventCompletionEntry): FinancialEmailPlan {
  const transfer = entry.kind === "transfer" || entry.kind === "transfer_schedule";
  const operation = entry.kind === "bill" ? "create_schedule" : entry.kind === "transfer" ? "create_transfer"
    : entry.kind === "transfer_schedule" ? "create_transfer_schedule" : "create_transaction";
  const eventKind = entry.kind === "bill" ? "bill_issued" : entry.kind === "transfer" ? "account_transfer_completed"
    : entry.kind === "transfer_schedule" ? "payment_scheduled" : entry.kind === "income" ? "payment_completed" : "purchase";
  return {
    version: 1, identity: { version: 1, status: "resolved", key: eventId },
    candidate: { type: entry.kind === "transfer_schedule" ? "transfer" : entry.kind, event_kind: eventKind, amount: entry.amount,
    amount_kind: entry.kind === "bill" ? "total_due" : transfer ? "payment_amount" : "transaction_amount",
      due_date: entry.date, payee: entry.payee, currency: "USD" },
    classification: { documentKind: entry.kind === "bill" ? "utility_statement" : entry.kind === "income" ? "income" : "one_time_transaction",
      eventKind, confidence: 1, reasons: [] },
    operation: { intended: operation, kind: operation, reasons: [] },
    targets: { account: target("account", entry.accountId), payee: target("payee", null, entry.payee),
      category: target("category", entry.categoryId), fromAccount: target("from_account", entry.fromAccountId),
      toAccount: target("to_account", entry.toAccountId), schedule: target("schedule", null, entry.scheduleName) },
    reconciliation: { status: "not_checked", disposition: "review", reason: "Your confirmed entry is queued for an Actual check.", checkedAt: null, evidence: null },
    reviewReasons: [], automation: { eligible: false, rollout: "enabled",
      operationClass: entry.kind === "bill" ? "utility_schedule" : entry.kind === "transfer" ? "completed_transfer"
        : entry.kind === "transfer_schedule" ? "transfer_schedule" : entry.kind === "income" ? "income" : "one_time_expense",
      gates: [{ gate: "actual_preflight", status: "unknown", reasons: ["actual_preflight_not_run"] }], reasons: ["actual_preflight_not_run"] },
  };
}

export function ownerCompletionOperation(eventId: string, entry: FinancialEventCompletionEntry): FinancialEventOperation {
  const identityKey = `financial-event:${eventId}`;
  const amountCents = Math.round(entry.amount * 100);
  const date = entry.date;
  if (entry.kind === "transfer_schedule") return { executor: "transfer_schedule", input: { identityKey,
    fromAccountId: entry.fromAccountId!, toAccountId: entry.toAccountId!, amountCents, date, name: entry.scheduleName || "Payment" } };
  if (entry.kind === "transfer") return { executor: "financial", input: { kind: "completed_transfer", identityKey,
    fromAccountId: entry.fromAccountId!, toAccountId: entry.toAccountId!, amountCents, date, notes: entry.notes || "" } };
  const base = { identityKey, accountId: entry.accountId!, payee: entry.payee!, categoryId: entry.categoryId || null, date };
  return entry.kind === "bill" ? { executor: "financial", input: { ...base, kind: "utility_schedule", amountCents: -amountCents,
    name: entry.scheduleName || entry.payee! } } : { executor: "financial", input: { ...base, kind: "transaction",
    amountCents: entry.kind === "income" ? amountCents : -amountCents, notes: entry.notes || "" } };
}
