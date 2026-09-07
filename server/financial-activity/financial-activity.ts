import type { Client, Row } from "@libsql/client";
import db from "../db/connection.ts";
import { capturedActivityDisplay, capturedActivitySources } from "./financial-activity-display.ts";
import type { FinancialActivity, FinancialActivityPage, FinancialActivityQuery, FinancialActivityReference,
  FinancialOriginalReceipt, FinancialWriteEvidence } from "../../shared/types/financial-activity.ts";
import { projectReviewItem } from "../financial-events/financial-event-review.ts";
import { hydrateManagedFinancialActivity, projectManagedFinancialPlan } from "../financial-events/financial-event-status.ts";
import { projectTransactionImportItem, projectTransactionImportRun,
  transactionImportActivityActions } from "../transaction-imports/transaction-import-store-projections.ts";

function parse<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}
function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }
const completed = new Set(["added", "updated", "already_present"]);
const key = (reference: FinancialActivityReference) => `${reference.owner}:${reference.id}`;

/** One snapshot precedes semantic filtering, alias grouping, counts and pagination. */
export function createFinancialActivityReader(dbClient: Pick<Client, "batch"> = db) {
  async function snapshot(userId: string, includeInactive = false, includeHistory = false): Promise<FinancialActivity[]> {
    if (!userId) invalid("An authenticated owner is required");
    const results = await dbClient.batch([
      { sql: "SELECT * FROM ea_financial_events WHERE user_id = ?", args: [userId] },
      { sql: `SELECT d.*, e.subject, e.from_name, e.from_address, e.email_date_utc,
          event.owner_completion_json AS event_owner_completion_json
        FROM ea_financial_documents d LEFT JOIN ea_email_index e ON e.user_id = d.user_id AND e.uid = d.email_uid
        LEFT JOIN ea_financial_events event ON event.user_id = d.user_id AND event.id = d.event_id
        WHERE d.user_id = ? ORDER BY d.id`, args: [userId] },
      { sql: "SELECT * FROM ea_transaction_import_items WHERE user_id = ?", args: [userId] },
      { sql: "SELECT * FROM ea_transaction_import_runs WHERE user_id = ?", args: [userId] },
      { sql: "SELECT * FROM ea_financial_activity_occurrences WHERE user_id = ?", args: [userId] },
      { sql: "SELECT * FROM ea_financial_identity_conflicts WHERE user_id = ?", args: [userId] },
      { sql: "SELECT * FROM ea_financial_actual_bindings WHERE user_id = ?", args: [userId] },
      { sql: "SELECT * FROM ea_financial_original_receipts WHERE user_id = ? ORDER BY captured_at, record_id", args: [userId] },
      { sql: "SELECT * FROM ea_financial_corrections WHERE user_id = ? ORDER BY rowid", args: [userId] },
      { sql: "SELECT * FROM ea_financial_effective_corrections WHERE user_id = ?", args: [userId] },
      ...(includeHistory ? [
        { sql: `SELECT s.correction_id, s.position, s.state, s.attempted_at FROM ea_financial_correction_steps s
          JOIN ea_financial_corrections c ON c.id = s.correction_id WHERE c.user_id = ? ORDER BY s.position`, args: [userId] },
        { sql: `SELECT uid, subject, email_date_utc FROM ea_email_index WHERE user_id = ? AND uid IN (
          SELECT email_uid FROM ea_transaction_import_items WHERE user_id = ?)`, args: [userId, userId] },
      ] : []),
    ], "read");
    const [events, documents, imports, runs, occurrences, conflicts, bindings, receipts, corrections, effectiveCorrections, correctionSteps, importEmails] = results.map((result) => result.rows);
    const emailMap = new Map([...(importEmails || []), ...documents!].map(row => [String(row.email_uid || row.uid), row]));
    const occurrenceMap = new Map(occurrences!.map((row) => [`${row.owner}:${row.record_id}`, row]));
    const runMap = new Map(runs!.map((row) => [String(row.id), projectTransactionImportRun(row)]));
    const receiptMap = new Map<string, FinancialOriginalReceipt[]>();
    for (const row of receipts!) {
      const occurrence = occurrenceMap.get(`${row.owner}:${row.record_id}`);
      if (!occurrence) continue;
      const reference: FinancialActivityReference = row.owner === "event" ? { owner: "event", id: String(row.record_id) }
        : { owner: "import", id: String(row.record_id), runId: String(occurrence.run_id) };
      const result = parse<{ evidence?: FinancialWriteEvidence }>(row.result_json);
      const receipt: FinancialOriginalReceipt = { reference, revision: row.revision == null ? null : Number(row.revision),
        capturedAt: Number(row.captured_at), captureKind: row.capture_kind === "historical" ? "historical" : "settlement",
        outcome: String(row.outcome), input: parse(row.input_json), result,
        evidence: result?.evidence || null };
      const id = String(occurrence.activity_id);
      receiptMap.set(id, [...(receiptMap.get(id) || []), receipt]);
    }
    const targets = (id: string): FinancialWriteEvidence[] => {
      const budgets = new Map<string, FinancialWriteEvidence>();
      for (const row of bindings!.filter((row) => row.activity_id === id)) {
        const budgetId = String(row.budget_id);
        const evidence = budgets.get(budgetId) || { budgetId, objects: [] };
        const object = parse<FinancialWriteEvidence["objects"][number]>(row.evidence_json);
        if (object) evidence.objects.push(object);
        budgets.set(budgetId, evidence);
      }
      return [...budgets.values()];
    };
    const output: FinancialActivity[] = [];
    const groupedDocuments = new Map<string, Row[]>();
    for (const row of documents!) {
      const id = row.event_id == null ? `document:${row.id}` : `event:${row.event_id}`;
      groupedDocuments.set(id, [...(groupedDocuments.get(id) || []), row]);
    }
    const managed = (row: Row, sourceRows: Row[], isDocument: boolean): FinancialActivity | null => {
      if (!includeInactive && isDocument && (!row.candidate_json || row.status === "ignored")) return null;
      const { documents: docs, event } = hydrateManagedFinancialActivity(isDocument ? null : row, sourceRows);
      const reference: FinancialActivityReference = { owner: isDocument ? "document" : "event", id: String(row.id) };
      const id = String(occurrenceMap.get(key(reference))?.activity_id || JSON.stringify([reference.owner, reference.id]));
      const originalReceipts = receiptMap.get(id) || [];
      const outcome = parse<{ outcome?: string }>(row.outcome_json);
      const successful = completed.has(outcome?.outcome || "") || originalReceipts.length > 0;
      if (!includeInactive && !isDocument && row.status === "settled" && !successful) return null;
      const inactive = row.status === "ignored" || (row.status === "settled" && !successful);
      const source = sourceRows[0];
      const review = projectReviewItem({ ...row, ...(source ? { email_uid: source.email_uid, subject: source.subject,
        from_name: source.from_name, candidate_json: source.candidate_json, received_at: source.email_date_utc } : {}),
        entity_id: key(reference), state: row.status === "retry" ? "waiting" : row.status,
        reason: row.reason || row.last_error, related_emails: sourceRows.length });
      const waiting = ["waiting", "needs_review", "retry"].includes(String(row.status));
      const attention = waiting && review.attention !== "retrying";
      const plan = docs[0] ? projectManagedFinancialPlan(docs[0], event) : event?.plan || null;
      return { id, reference, occurrences: [reference, ...docs.filter(() => !isDocument).map((doc): FinancialActivityReference => ({ owner: "document", id: String(doc.id) }))], source: "managed", contexts: ["arrival"],
        emailUids: docs.map((doc) => doc.emailUid), subject: review.subject, payee: review.payee,
        amountCents: review.amount == null ? null : Math.round(review.amount * 100), currency: review.currency,
        ...(successful ? capturedActivityDisplay(originalReceipts[0]) : {}),
        createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
        status: inactive ? "dismissed" : attention ? "needs_attention" : successful ? "completed" : "processing",
        reason: inactive ? "No financial entry is needed." : review.reason,
        actions: { complete: attention && review.canComplete && docs.length > 0, retry: false, inspect: true, correct: false },
        originalReceipts, sourceEvidence: (successful ? capturedActivitySources(originalReceipts[0]) || [] : null) || sourceRows.map((source) => ({ emailUid: source.email_uid, revision: source.revision, candidate: parse(source.candidate_json) })), targetBindings: targets(id), liveState: "not_checked", effectiveResult: originalReceipts[0]?.result || outcome,
        completionPlan: plan, importItem: null, runs: [] };
    };
    for (const row of events!) {
      const activity = managed(row, groupedDocuments.get(`event:${row.id}`) || [], false);
      if (activity) output.push(activity);
    }
    for (const row of documents!.filter((row) => row.event_id == null)) {
      const activity = managed(row, [row], true);
      if (activity) output.push(activity);
    }
    const legacyGroups = new Map<string, Row[]>();
    for (const row of imports!) {
      const id = String(occurrenceMap.get(`import:${row.id}`)?.activity_id || JSON.stringify(["import-item", row.id]));
      legacyGroups.set(id, [...(legacyGroups.get(id) || []), row]);
    }
    for (const [id, rows] of legacyGroups) {
      rows.sort((a, b) => Number(b.updated_at) - Number(a.updated_at) || String(b.id).localeCompare(String(a.id)));
      const originalReceipts = receiptMap.get(id) || [];
      // An aliased repeat run cannot hide the successful original activity behind a new untouched candidate.
      const selected = rows.find((row) => completed.has(String(row.status))) || rows[0]!;
      const item = projectTransactionImportItem(selected);
      const policy = transactionImportActivityActions(item);
      const identityConflict = conflicts!.some((conflict) => rows.some((row) => row.id === conflict.record_id));
      const reference: FinancialActivityReference = { owner: "import", id: item.id, runId: item.runId };
      const activityRuns = [...new Set(rows.map((row) => String(row.run_id)))].flatMap((id) => runMap.get(id) || []);
      const successful = completed.has(item.status) || originalReceipts.length > 0;
      output.push({ ...(identityConflict ? { identityConflict: true as const } : {}), id, reference, occurrences: rows.map((row) => ({ owner: "import", id: String(row.id), runId: String(row.run_id) })),
        source: item.source, contexts: [...new Set(activityRuns.map((run) => run.trigger))],
        emailUids: [...new Set(rows.map((row) => String(row.email_uid)))], subject: item.emailSubject,
        payee: item.payee, amountCents: item.amountCents, currency: item.currency,
        ...(successful ? capturedActivityDisplay(originalReceipts[0]) : {}),
        createdAt: Math.min(...rows.map((row) => Number(row.created_at))), updatedAt: Math.max(...rows.map((row) => Number(row.updated_at))),
        status: identityConflict ? "needs_attention" : successful ? "completed" : policy.attention ? "needs_attention" : item.status === "dismissed" ? "dismissed" : "processing",
        reason: identityConflict ? "Original financial identity aliases conflict; resolve the exact source before importing." : item.lastError || item.status.replaceAll("_", " "),
        actions: { complete: !identityConflict && !successful && policy.complete, retry: !identityConflict && !successful && policy.retry, inspect: true, correct: false },
        originalReceipts, sourceEvidence: rows.map((row) => parse(occurrenceMap.get(`import:${row.id}`)?.source_snapshot_json)), targetBindings: targets(id), liveState: "not_checked", effectiveResult: originalReceipts[0]?.result || null,
        completionPlan: item.financialPlan, importItem: item, runs: activityRuns });
    }
    for (const activity of output) {
      const activityCorrections = corrections!.filter(row => row.activity_id === activity.id);
      const current = activityCorrections.at(-1);
      if (includeHistory) activity.history = {
        emails: [...new Set(activity.emailUids)].map(uid => {
          const email = emailMap.get(uid);
          const receivedAt = email?.email_date_utc ? Date.parse(String(email.email_date_utc)) : NaN;
          return { uid, subject: String(email?.subject || 'Source email'), receivedAt: Number.isFinite(receivedAt) ? receivedAt : null };
        }),
        corrections: activityCorrections.map(row => ({ id: String(row.id), predecessorId: row.predecessor_id == null ? null : String(row.predecessor_id),
          state: row.state as NonNullable<FinancialActivity['correction']>['state'], updatedAt: Number(row.updated_at),
          steps: (correctionSteps || []).filter(step => step.correction_id === row.id).map(step => ({
            state: step.state as NonNullable<FinancialActivity['history']>['corrections'][number]['steps'][number]['state'],
            attemptedAt: step.attempted_at == null ? null : Number(step.attempted_at),
          })),
        })),
      };
      const effective = effectiveCorrections!.find(row => row.activity_id === activity.id);
      if (effective) {
        const result = parse<{ entry?: { amountCents?: number; payee?: string } }>(effective.effective_result_json);
        activity.effectiveResult = result;
        activity.amountCents = result?.entry?.amountCents ?? activity.amountCents;
        activity.payee = result?.entry?.payee ?? activity.payee;
      }
      activity.actions.correct = !activity.identityConflict && activity.originalReceipts.length > 0 && activity.targetBindings.length === 1;
      if (current) {
        activity.correction = { id: String(current.id), state: current.state as NonNullable<FinancialActivity['correction']>['state'], revision: Number(current.revision) };
        activity.actions.complete = false; activity.actions.retry = false;
        if (['applying', 'recovering'].includes(String(current.state))) {
          activity.status = 'processing'; activity.reason = current.state === 'applying' ? 'Applying the confirmed correction.' : 'Recovering the correction; its attempted steps will not be replayed.';
          activity.actions.correct = false;
        } else if (current.state === 'attention') {
          activity.status = 'needs_attention'; activity.reason = 'The correction stopped and requires attention. Its observed effects are preserved.';
        }
      }
    }
    return output.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }
  return {
    async list(userId: string, query: FinancialActivityQuery = {}): Promise<FinancialActivityPage> {
      const offset = query.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) invalid("Financial activity offset must be a nonnegative integer");
      if (query.view && !["all", "completed", "needs_attention"].includes(query.view)) invalid("Invalid financial activity view");
      if (query.source && !["managed", "amazon", "paypal", "generic"].includes(query.source)) invalid("Invalid financial activity source");
      if (query.context && !["arrival", "historical_scan"].includes(query.context)) invalid("Invalid financial activity context");
      const items = (await snapshot(userId)).filter((item) => (!query.view || query.view === "all" || item.status === query.view)
        && (!query.source || item.source === query.source) && (!query.context || item.contexts.includes(query.context))
        && (!query.runId || item.runs.some((run) => run.id === query.runId)));
      return { items: items.slice(offset, offset + 20), total: items.length, offset, limit: 20 };
    },
    async detail(userId: string, reference: FinancialActivityReference): Promise<FinancialActivity | null> {
      if (!reference || !["event", "document", "import"].includes(reference.owner) || !reference.id) invalid("An exact financial activity reference is required");
      const items = await snapshot(userId, true, true);
      return items.find((item) => item.occurrences.some((entry) => key(entry) === key(reference)
        && (reference.owner !== "import" || (entry.owner === "import" && entry.runId === reference.runId)))) || null;
    },
  };
}
export const financialActivityReader = createFinancialActivityReader();
