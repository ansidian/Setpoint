import { financialEventStore, createFinancialEventStore, readManagedFinancialEmailUids,
  type FinancialStatusDb, type FinancialDocument, type FinancialEvent } from "./financial-event-store.ts";
import { completionBlocker } from "./financial-event-completion-model.ts";
import type { FinancialEmailPlan, FinancialPlanTarget, FinancialTargetKind } from "../../shared/types/bills.ts";
import type { Row } from "@libsql/client";
import { documentFromRow, eventFromRow } from "./financial-event-store.ts";

/** Shared history hydrates a consistent saved snapshot through the managed owner. */
export function hydrateManagedFinancialActivity(row: Row | null, sources: Row[]) {
  const documents = sources.map(documentFromRow);
  return { documents, event: row ? eventFromRow(row, documents) : null };
}

/** Read-only ownership boundary shared by legacy ingestion and Inbox status. */
export function listManagedEmailUids(userId: string, uids: string[], { dbClient }: { dbClient?: FinancialStatusDb } = {}): Promise<string[]> {
  return readManagedFinancialEmailUids(userId, uids, dbClient);
}

export async function isManagedEmail(userId: string, uid: string, options?: { dbClient?: FinancialStatusDb }): Promise<boolean> {
  return (await listManagedEmailUids(userId, [uid], options)).length > 0;
}

function emptyTarget(kind: FinancialTargetKind): FinancialPlanTarget {
  return { kind, status: "not_applicable", provenance: [] };
}

/** A read never initiates assessment or releases a second write path. */
export async function resolveManagedFinancialPlan(userId: string, emailUid: string, {
  dbClient,
}: { dbClient?: FinancialStatusDb } = {}): Promise<FinancialEmailPlan | null> {
  const store = dbClient ? createFinancialEventStore(dbClient as Parameters<typeof createFinancialEventStore>[0]) : financialEventStore;
  const document = await store.getDocumentForEmail(userId, emailUid);
  if (!document) return null;
  const event = await store.getEventForEmail(userId, emailUid);
  return projectManagedFinancialPlan(document, event);
}

export function projectManagedFinancialPlan(document: FinancialDocument, event: FinancialEvent | null): FinancialEmailPlan {
  const state = event?.status === "processing" ? "pending" : event?.status
    || (document.status === "ignored" ? "settled" : document.status === "retry" ? "waiting" : "pending");
  const reason = event?.reason || document.error || (state === "settled" ? "No financial entry is needed."
    : document.status === "associated" ? "Collecting related payment details." : "Checking this email for financial activity.");
  const plan: FinancialEmailPlan = event?.plan ? structuredClone(event.plan) : {
    version: 1, identity: { version: 1, status: "resolved", key: event?.id || `financial-document:${document.id}` },
    candidate: document.candidate || {},
    classification: { documentKind: "informational", eventKind: document.candidate?.event_kind || null, confidence: null, reasons: [] },
    operation: { intended: null, kind: state === "settled" ? "no_write" : "review", reasons: [] },
    targets: { account: emptyTarget("account"), payee: emptyTarget("payee"), category: emptyTarget("category"),
      fromAccount: emptyTarget("from_account"), toAccount: emptyTarget("to_account"), schedule: emptyTarget("schedule") },
    reconciliation: { status: "not_checked", disposition: "review", reason, checkedAt: null, evidence: null },
    reviewReasons: [], automation: { eligible: false, operationClass: "unsupported", rollout: "observe_only", gates: [], reasons: [] },
  };
  if (document.correctedEntry) {
    const entry = document.correctedEntry;
    plan.candidate = { ...plan.candidate, type: entry.kind === 'transfer_schedule' ? 'transfer' : entry.kind,
      amount: entry.amount, amount_candidates: undefined, amount_verification: undefined, due_date: entry.date,
      payee: entry.payee, currency: 'USD' };
    for (const [key, id] of Object.entries({ account: entry.accountId, fromAccount: entry.fromAccountId,
      toAccount: entry.toAccountId, category: entry.categoryId, payee: entry.payeeId, schedule: entry.scheduleId })) {
      const target = plan.targets[key as keyof typeof plan.targets];
      plan.targets[key as keyof typeof plan.targets] = { kind: target.kind, status: id ? 'resolved' : 'not_applicable', id: id || null, provenance: [] };
    }
    plan.operation = { ...plan.operation, kind: 'no_write' };
    plan.automation = { ...plan.automation, eligible: false };
  }
  const blockedReason = document.correctedEntry ? 'This source has an explicit correction and cannot be resubmitted.' : completionBlocker(event);
  return { ...plan, workflow: { id: event?.id || `financial-document:${document.id}`, state,
    relatedEmails: event?.documents.length || 1, reason, nextAttemptAt: event?.nextAttemptAt || document.nextAttemptAt,
    completion: { emailUid: document.emailUid, documentRevision: document.revision, eventRevision: event?.revision ?? null,
      canComplete: !blockedReason, ...(blockedReason ? { blockedReason } : {}) } } };
}
