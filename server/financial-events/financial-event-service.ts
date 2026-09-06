import { randomUUID } from "node:crypto";
import { assessFinancialDocument, canAssessFinancialDocuments } from "../triage/financial-document-classifier.ts";
import { planFinancialEmail, financialEmailSourceIdentity, hasFinancialSemanticConflict, hasExplicitDateForYmd } from "../bills/financial-email-planner.ts";
import { invalidateActualAfterTransactionImport } from "../bills/bills-service.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.ts";
import { withAiUsageContext } from "../platform/ai-usage.ts";
import { requireCompleteEmailEvidence } from "../email/email-evidence.ts";
import { getMetadata as actualGetMetadata } from "../actual/actual.ts";
import { financialEventStore, type FinancialEventStore, type FinancialEvent } from "./financial-event-store.ts";
import { combineFinancialEventEvidence, correlateFinancialDocument, financialDocumentContentHash, financialDocumentReferenceKey, financialEvidenceChangedAfterAttempt } from "./financial-event-evidence.ts";
import { bindFinancialEventOperation, buildFinancialEventOperation, createFinancialEventExecutor,
  financialEventPlanBlocker, planWithActualResult, type FinancialEventOperation } from "./financial-event-operation.ts";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";
import type { ActualFinancialOperationResult } from "../../shared/types/financial-operations.ts";
import { ownerCompletionNeedsAccountEvidence, ownerCompletionOperation, ownerCompletionPlan, ownerCompletionSourceChanged } from "./financial-event-completion-model.ts";

const COLLECT_EVIDENCE_MS = 90_000;
const WAIT_FOR_EVIDENCE_MS = 15 * 60_000;

function retryAt(now: number, attempts: number): number {
  return now + Math.min(30_000 * 2 ** Math.min(attempts, 7), 60 * 60_000);
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export function createFinancialEventWorker({
  store = financialEventStore,
  assessDocument = assessFinancialDocument,
  canRun = canAssessFinancialDocuments,
  planner = planFinancialEmail,
  execute = createFinancialEventExecutor(),
  metadataReader = actualGetMetadata,
  now = Date.now,
  afterWrite = invalidateActualAfterTransactionImport,
}: {
  store?: FinancialEventStore;
  assessDocument?: typeof assessFinancialDocument;
  canRun?: typeof canAssessFinancialDocuments;
  planner?: typeof planFinancialEmail;
  execute?: ReturnType<typeof createFinancialEventExecutor>;
  metadataReader?: typeof actualGetMetadata;
  now?: () => number;
  afterWrite?: typeof invalidateActualAfterTransactionImport;
} = {}) {
  function publish(userId: string): void {
    publishCurrentDashboardEvent(userId, { source: "email_triage", reason: "financial_event_changed", state: "current" });
  }

  async function confirmedSourceChanged(event: FinancialEvent): Promise<boolean> {
    const metadata = ownerCompletionNeedsAccountEvidence(event)
      ? await metadataReader(event.userId).catch(() => null) : null;
    return ownerCompletionSourceChanged(event, metadata);
  }

  async function processNextDocument(): Promise<boolean> {
    const document = await store.claimDocument(randomUUID());
    if (!document) return false;
    const contentHash = financialDocumentContentHash(document);
    try {
      if (document.eventId && (await store.getEventForEmail(document.userId, document.emailUid))?.ownerCompletion) {
        // The owner supplied the financial facts. Source changes still wake the
        // event, but paused AI or the original incomplete extraction cannot undo
        // that confirmation or keep an admitted operation from recovery.
        const referenceKey = document.senderAuthentication?.status === "pass" ? financialDocumentReferenceKey(document) : null;
        await store.acknowledgeOwnerCompletedDocument(document, contentHash, referenceKey);
        publish(document.userId);
        return true;
      }
      requireCompleteEmailEvidence(document.body);
      const unchanged = document.contentHash === contentHash;
      const candidate = unchanged && (document.candidate || document.processedRevision > 0)
        ? document.candidate
        : await withAiUsageContext({ userId: document.userId, origin: "transaction_import", accountId: document.accountId, emailId: document.emailUid },
          () => assessDocument(document.userId, {
            user_id: document.userId, account_id: document.accountId, email_id: document.emailUid,
            from_name: document.fromName, from_address: document.fromAddress, subject: document.subject,
            body_text: document.body, email_date: document.emailDate, email_date_utc: document.emailDate,
            thread_id: document.threadId,
          }));
      if (!candidate) {
        await store.settleDocument(document, { candidate: null, contentHash, status: "ignored" });
        publish(document.userId);
        return true;
      }
      const failedVerification = [candidate.amount_verification, candidate.event_verification, candidate.type_verification]
        .some((verification) => verification?.status === "failed");
      const missingSourceDate = candidate.event_kind && !["payment_cancelled", "payment_failed", "other"].includes(candidate.event_kind)
        && !hasExplicitDateForYmd(`${document.subject}\n${document.body}`, candidate.due_date);
      // Reassess failed or incomplete extraction against the whole source before
      // caching it or assigning an event identity. Retries remain bounded when
      // the source itself cannot supply the missing facts.
      if ((hasFinancialSemanticConflict(candidate) || failedVerification || missingSourceDate) && document.attempts < 3) {
        await store.settleDocument(document, { candidate: null, contentHash: "", status: "retry",
          error: "Reassessing incomplete or conflicting payment details.", nextAttemptAt: retryAt(now(), document.attempts) });
        publish(document.userId);
        return true;
      }
      if (document.senderAuthentication?.status !== "pass" && !document.eventId) {
        await store.settleDocument(document, { candidate, contentHash, status: "retry",
          error: "Waiting for verified sender authentication.", nextAttemptAt: now() + WAIT_FOR_EVIDENCE_MS });
        publish(document.userId);
        return true;
      }
      const source = { ...document, candidate };
      // A changed authentication verdict may invalidate an existing event's
      // evidence, but it cannot register another trusted financial identity.
      const referenceKey = document.senderAuthentication?.status === "pass" ? financialDocumentReferenceKey(source) : null;
      const aliases = referenceKey ? await store.findEventsByReference(document.userId, referenceKey) : [];
      const date = Date.parse(document.emailDate);
      const previous = await store.listDocuments(document.userId, { since: date - 5 * 60_000, until: date + 5 * 60_000, limit: 200 });
      const correlation = aliases.length === 1 ? { eventId: aliases[0]!, ambiguous: false }
        : correlateFinancialDocument(source, previous);
      const wasAmbiguous = document.error === "Waiting for evidence that distinguishes similar purchases.";
      if (correlation.ambiguous || (!correlation.eventId && (wasAmbiguous || previous.length >= 200))) {
        await store.settleDocument(document, { candidate, contentHash, status: "retry",
          error: "Waiting for evidence that distinguishes similar purchases.", nextAttemptAt: now() + WAIT_FOR_EVIDENCE_MS });
        publish(document.userId);
        return true;
      }
      const associated = await store.associateDocument(document, { candidate, contentHash, eventId: correlation.eventId || randomUUID(), referenceKey,
        nextAttemptAt: now() + COLLECT_EVIDENCE_MS });
      if (!associated) await store.settleDocument(document, { candidate, contentHash, status: "retry",
        error: "Waiting for evidence that distinguishes similar purchases.", nextAttemptAt: now() + WAIT_FOR_EVIDENCE_MS });
      publish(document.userId);
    } catch (error) {
      await store.settleDocument(document, { candidate: document.candidate, contentHash: document.contentHash || "", status: "retry",
        error: `Financial assessment will retry: ${errorText(error)}`, nextAttemptAt: retryAt(now(), document.attempts) });
    }
    return true;
  }

  async function settle(event: FinancialEvent, plan: FinancialEmailPlan | null, state: "waiting" | "settled" | "needs_review", reason: string,
    result?: ActualFinancialOperationResult): Promise<void> {
    const nextAttemptAt = state === "waiting" ? now() + WAIT_FOR_EVIDENCE_MS : null;
    const projected = plan ? { ...plan, workflow: { id: event.id, state, relatedEmails: event.documents.length, reason, nextAttemptAt } } : null;
    const saved = await store.saveEvent(event, { plan: projected, status: state, reason, nextAttemptAt, outcome: result });
    if (saved) publish(event.userId);
  }

  async function settleActualResult(event: FinancialEvent, plan: FinancialEmailPlan | null,
    result: ActualFinancialOperationResult): Promise<void> {
    const done = ["added", "updated", "already_present"].includes(result.outcome);
    const nextPlan = plan ? planWithActualResult(plan, result, now()) : null;
    await settle(event, nextPlan, done ? "settled" : result.outcome === "needs_review" ? "needs_review" : "waiting", result.reason, result);
    if (done) await afterWrite(event.userId).catch((error: unknown) => {
      console.warn("[Financial Events] Actual projection refresh will retry:", errorText(error));
    });
  }

  async function processNextEvent(): Promise<boolean> {
    const event = await store.claimEvent(randomUUID());
    if (!event) return false;
    let plan = event.plan;
    let attempted = event.attemptedAt !== null;
    try {
      if (attempted) {
        // Admission is irreversible. A crash or a later email can only lead back
        // to read/sync/reconcile of exactly this payload and this budget.
        const operation = event.operation as FinancialEventOperation | null;
        if (!operation || !["financial", "transfer_schedule"].includes(operation.executor) || !operation.input?.budgetId) {
          await settle(event, plan, "needs_review", "The saved operation is incomplete. Check this event in Actual before recording it.");
          return true;
        }
        const result = await execute(event.userId, operation, "recover");
        const current = event.ownerCompletion ? null : combineFinancialEventEvidence(event.documents);
        const changed = event.ownerCompletion ? await confirmedSourceChanged(event)
          : current!.conflict || financialEvidenceChangedAfterAttempt(current!.candidate, plan?.candidate || null);
        if (changed) {
          await settle(event, plan, "needs_review", event.ownerCompletion
            ? "New source details arrived after your confirmation. The existing Actual entry was preserved."
            : "New source details conflict with the earlier Actual operation. The existing entry was preserved.", result);
        } else await settleActualResult(event, plan, result);
        return true;
      }
      let operation: FinancialEventOperation | null;
      if (event.ownerCompletion) {
        if (await confirmedSourceChanged(event)) {
          await settle(event, plan, "needs_review", "New source details arrived after your confirmation. Review and confirm the entry again.");
          return true;
        }
        plan = ownerCompletionPlan(event.id, event.ownerCompletion.entry);
        operation = ownerCompletionOperation(event.id, event.ownerCompletion.entry);
      } else {
        if (!await canRun(event.userId)) {
          await settle(event, plan, "waiting", "Financial processing is paused while email AI is disabled.");
          return true;
        }
        const evidence = combineFinancialEventEvidence(event.documents);
        if (!event.documents.some((document) => document.candidate)) {
          await settle(event, null, "settled", "The latest source assessment requires no financial entry.");
          return true;
        }
        if (!evidence.authenticated || !evidence.candidate || evidence.conflict) {
          await settle(event, plan, "waiting", evidence.conflict ? "Related emails contain conflicting payment details."
            : "Waiting for verified sender authentication.");
          return true;
        }
        const primary = event.documents.find((document) => document.candidate && document.senderAuthentication?.status === "pass")!;
        plan = await planner(event.userId, { candidate: evidence.candidate, source: "financial_event", providerMessageId: event.id,
          email: { from: primary.fromAddress, subject: primary.subject, body: evidence.body },
          sourceIdentity: financialEmailSourceIdentity({ account_id: primary.accountId, from_address: primary.fromAddress,
            sender_authentication_json: primary.senderAuthentication }) });
        const blocker = financialEventPlanBlocker(plan);
        if (blocker) {
          await settle(event, plan, "waiting", blocker);
          return true;
        }
        if (plan.operation.intended === "no_write") {
          await settle(event, plan, "settled", "This notice does not confirm a new transaction or obligation.");
          return true;
        }
        if (!plan.candidate.due_date || !event.documents.some((document) => document.senderAuthentication?.status === "pass"
          && hasExplicitDateForYmd(`${document.subject}\n${document.body}`, plan!.candidate.due_date!))) {
          await settle(event, plan, "waiting", "Waiting for an explicit transaction or payment date.");
          return true;
        }
        operation = buildFinancialEventOperation(event.id, plan);
      }
      if (!operation) {
        await settle(event, plan, "waiting", "Waiting for complete payment amount, currency and account details.");
        return true;
      }
      const preview = await execute(event.userId, operation, "preview");
      plan = planWithActualResult(plan, preview, now());
      if (!["would_add", "would_update"].includes(preview.outcome)) {
        await settleActualResult(event, plan, preview);
        return true;
      }
      if (!plan.automation.eligible || !preview.budgetId) {
        await settle(event, plan, "waiting", "The current Actual check has not established a safe operation.");
        return true;
      }
      const bound = bindFinancialEventOperation(operation, preview);
      if (!await store.admitOperation(event, bound, plan)) {
        await settle(event, plan, "waiting", "New source evidence arrived; the operation will be checked again.");
        return true;
      }
      attempted = true;
      await settleActualResult(event, plan, await execute(event.userId, bound, "write_once"));
    } catch (error) {
      await settle(event, plan, "waiting", `${attempted ? "Verifying the previous Actual operation" : "Financial processing will retry"}: ${errorText(error)}`);
    }
    return true;
  }

  return { processNextDocument, processNextEvent, getNextWakeAt: store.getNextWakeAt, recoverStaleClaims: store.recoverStaleClaims };
}

export const financialEventWorker = createFinancialEventWorker();
