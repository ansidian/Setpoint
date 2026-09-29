import { randomUUID } from "node:crypto";
import { financialEventStore, type FinancialEventStore } from "./financial-event-store.ts";
import { completionBlocker, dismissalBlocker, ownerCompletionPlan, ownerCompletionSnapshot, parseFinancialEventCompletion } from "./financial-event-completion-model.ts";
import { financialDocumentReferenceKey } from "./financial-event-evidence.ts";
import { projectManagedFinancialPlan } from "./financial-event-status.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.ts";
import { extractBillCandidate } from "../bills/bills-service.ts";
import type { BillCandidate, FinancialEmailPlan } from "../../shared/types/bills.ts";

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }

/** Owner confirmation joins the existing durable event; it never writes to Actual directly. */
export function createFinancialEventCompletion({ store = financialEventStore, now = Date.now, extract = extractBillCandidate }: {
  store?: FinancialEventStore; now?: () => number; extract?: typeof extractBillCandidate;
} = {}) {
  function revisionRequest(value: unknown, message: string) {
    const request = value as { emailUid?: unknown; documentRevision?: unknown; eventRevision?: unknown; extract?: unknown } | null;
    if (!request || typeof request.emailUid !== "string" || !request.emailUid.trim() || request.emailUid.length > 500
      || !Number.isSafeInteger(request.documentRevision) || Number(request.documentRevision) < 1
      || !(request.eventRevision === null || Number.isSafeInteger(request.eventRevision) && Number(request.eventRevision) > 0)) {
      fail(400, message);
    }
    return request as { emailUid: string; documentRevision: number; eventRevision: number | null; extract?: unknown };
  }
  async function complete(userId: string, value: unknown): Promise<FinancialEmailPlan> {
    const request = parseFinancialEventCompletion(value);
    const document = await store.getDocumentForEmail(userId, request.emailUid);
    if (!document) fail(404, "This email is not managed by the financial workflow");
    const event = await store.getEventForEmail(userId, request.emailUid);
    if (document.revision !== request.documentRevision || (event?.revision ?? null) !== request.eventRevision) {
      fail(409, "This email changed. Close this form and check its current status before confirming again.");
    }
    const blocker = document.dismissedAt != null ? "This candidate was dismissed." : completionBlocker(event);
    if (blocker) fail(409, blocker);
    const eventId = event?.id || randomUUID();
    const entry = request.entry;
    if (entry.kind === "bill" && !entry.scheduleName) entry.scheduleName = entry.payee;
    if (entry.kind === "transfer_schedule" && !entry.scheduleName) {
      const destination = event?.plan?.targets.toAccount;
      entry.scheduleName = destination && destination.id === entry.toAccountId && destination.label ? `${destination.label} Payment` : "Transfer payment";
    }
    const plan = ownerCompletionPlan(eventId, entry);
    const completion = ownerCompletionSnapshot(entry, event?.documents || [document], now(), randomUUID());
    const referenceKey = document.senderAuthentication?.status === "pass" ? financialDocumentReferenceKey(document) : null;
    if (!await store.completeEvent(document, event, { eventId, plan, completion, referenceKey })) {
      fail(409, "This email or its related event changed. Close this form and check its current status before confirming again.");
    }
    const updatedDocument = await store.getDocumentForEmail(userId, request.emailUid);
    const updatedEvent = await store.getEventForEmail(userId, request.emailUid);
    if (!updatedDocument || !updatedEvent) throw new Error("The confirmed financial event could not be loaded");
    publishCurrentDashboardEvent(userId, { source: "email_triage", reason: "financial_event_changed", state: "current" });
    return projectManagedFinancialPlan(updatedDocument, updatedEvent);
  }
  async function dismiss(userId: string, value: unknown): Promise<FinancialEmailPlan> {
    const request = revisionRequest(value, "A current financial candidate revision is required.");
    const document = await store.getDocumentForEmail(userId, request.emailUid);
    if (!document) fail(404, "This email is not managed by the financial workflow");
    const event = await store.getEventForEmail(userId, request.emailUid);
    if (document.dismissedAt != null || event?.dismissedAt != null) return projectManagedFinancialPlan(document, event);
    if (document.revision !== request.documentRevision || (event?.revision ?? null) !== request.eventRevision) {
      fail(409, "This candidate changed. Refresh its status before dismissing it.");
    }
    const blocker = dismissalBlocker(document, event);
    if (blocker) fail(409, blocker);
    const referenceKey = document.senderAuthentication?.status === "pass" ? financialDocumentReferenceKey(document) : null;
    if (!await store.dismissCandidate(document, event, { eventId: event?.id || randomUUID(), referenceKey })) fail(409, "This candidate changed or was submitted. Refresh its status before trying again.");
    const updated = await store.getDocumentForEmail(userId, request.emailUid);
    if (!updated) throw new Error("The dismissed candidate could not be loaded");
    publishCurrentDashboardEvent(userId, { source: "email_triage", reason: "financial_event_changed", state: "current" });
    return projectManagedFinancialPlan(updated, await store.getEventForEmail(userId, request.emailUid));
  }
  /** Owner-initiated recording of an email the workflow ignored or settled without an entry.
   * Optional extraction only prefills the review form; it never authorizes a write. */
  async function request(userId: string, value: unknown): Promise<FinancialEmailPlan> {
    const input = revisionRequest(value, "A current financial record revision is required.");
    if (input.extract !== undefined && typeof input.extract !== "boolean") fail(400, "Extraction must be true or false.");
    const document = await store.getDocumentForEmail(userId, input.emailUid);
    if (!document) fail(404, "This email is not managed by the financial workflow");
    const event = await store.getEventForEmail(userId, input.emailUid);
    if (document.revision !== input.documentRevision || (event?.revision ?? null) !== input.eventRevision) {
      fail(409, "This email changed. Refresh its status before recording it.");
    }
    if (document.dismissedAt != null || event?.dismissedAt != null) fail(409, "This candidate was dismissed.");
    const blocker = completionBlocker(event);
    if (blocker) fail(409, blocker);
    if (event ? event.status !== "settled" : !["ignored", "retry"].includes(document.status)) {
      fail(409, "This email already has an open financial record.");
    }
    let candidate: BillCandidate = document.candidate || {};
    if (input.extract) {
      try {
        candidate = (await extract(userId, { subject: document.subject, from: document.fromAddress, body: document.body })).candidate;
      } catch (error) {
        // A registered provider's own parser remains authoritative for its templates.
        if ((error as { code?: string }).code !== "FINANCIAL_PROVIDER_REVIEW_REQUIRED") throw error;
      }
    }
    const reason = input.extract ? "Recording requested with extracted details. Check them before recording in Actual."
      : "Recording requested. Enter the details to record in Actual.";
    if (!await store.requestOwnerReview(document, event, { candidate, reason })) {
      fail(409, "This email or its financial record changed. Refresh its status before recording it.");
    }
    const updated = await store.getDocumentForEmail(userId, input.emailUid);
    if (!updated) throw new Error("The requested financial record could not be loaded");
    publishCurrentDashboardEvent(userId, { source: "email_triage", reason: "financial_event_changed", state: "current" });
    return projectManagedFinancialPlan(updated, await store.getEventForEmail(userId, input.emailUid));
  }
  return { complete, dismiss, request };
}

export const financialEventCompletion = createFinancialEventCompletion();
