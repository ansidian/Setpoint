import { createClient, type Client } from "@libsql/client";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFinancialActivityBinding } from "./financial-activity-binding.ts";
import { createFinancialActivityReader } from "./financial-activity.ts";
import { createTransactionImportStore } from "../transaction-imports/transaction-import-store.ts";
import { createFinancialEventStore } from "../financial-events/financial-event-store.ts";
import { createFinancialEventCompletion } from "../financial-events/financial-event-completion.ts";
import { ownerCompletionPlan } from "../financial-events/financial-event-completion-model.ts";

const migrations = ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql",
  "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql",
  "053_transaction_import_financial_plans.sql", "054_email_sender_authentication.sql", "055_generic_financial_email_imports.sql",
  "056_generic_financial_email_automation.sql", "058_generic_financial_email_income_automation.sql",
  "059_generic_financial_email_transfer_automation.sql", "062_financial_events.sql", "071_financial_event_readiness.sql", "068_financial_candidate_dismissal.sql", "063_financial_activity.sql", "064_financial_corrections.sql", "069_financial_profiles.sql"];

describe("shared financial activity history", () => {
  let db: Client;
  let directory: string;
  beforeEach(async () => {
    directory = await createTestTempDir("financial-activity-");
    db = createClient({ url: `file:${directory}/history.db` });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of migrations) await db.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    await db.execute("INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at) VALUES (1, 'owner', 'hash', 1)");
  });
  afterEach(async () => { db.close(); await removeTempDir(directory); });
  const reader = () => createFinancialActivityReader(db);
  async function item(id: string, { runId = `run-${id}`, importedId = id, candidateKey = id, messageId = id,
    createdAt = 1000, trigger = "arrival" as "historical_scan" | "arrival" } = {}) {
    const store = createTransactionImportStore(db, () => createdAt);
    await store.createRun({ id: runId, userId: "owner", trigger: "arrival", optionsKey: runId,
      gmailAccountIds: ["gmail"], sources: ["amazon"],  });
    await db.execute({ sql: 'UPDATE ea_transaction_import_runs SET trigger = ?, start_date = ?, end_date = ? WHERE id = ?', args: [trigger, trigger === 'historical_scan' ? '2026-01-01' : null, trigger === 'historical_scan' ? '2026-09-01' : null, runId] });
    await store.insertItem({ id, runId, userId: "owner", gmailAccountId: "gmail", gmailMessageId: messageId,
      emailUid: `gmail-${messageId}`, candidateKey, source: "amazon", parserVersion: "v1", importedId,
      date: "2026-09-01", amountCents: -1000, currency: "USD", payee: "Market", actualAccountId: "card",
      automationMode: "observe", automaticSafe: false, blockingWarnings: [], evidence: [], status: "needs_review" });
  }
  async function event(id: string, createdAt = 1000, owner = "owner", status = "waiting") {
    await db.execute({ sql: `INSERT INTO ea_financial_events (id, user_id, status, reason, created_at, updated_at)
      VALUES (?, ?, ?, 'Waiting for an explicit transaction or payment date.', ?, ?)`, args: [id, owner, status, createdAt, createdAt] });
  }
  it.each(["expense", "bill", "transfer", "income"] as const)("signs pending %s amounts consistently for documents and events", async (type) => {
    const candidate = { type, amount: 30, currency: "USD", amount_kind: "transaction_amount" };
    await db.execute({ sql: `INSERT INTO ea_financial_documents
      (user_id, account_id, email_uid, status, candidate_json, last_error, created_at, updated_at)
      VALUES ('owner', 'mail', 'pending-source', 'retry', ?, 'Waiting for an explicit transaction or payment date.', 1, 1)`,
      args: [JSON.stringify(candidate)] });
    const document = (await reader().list("owner", { view: "needs_attention" })).items[0]!;
    const expected = type === "income" ? 3000 : -3000;
    expect(document.amountCents).toBe(expected);
    expect((await reader().detail("owner", document.reference))?.amountCents).toBe(expected);
    await event("pending-event");
    await db.execute("UPDATE ea_financial_documents SET event_id = 'pending-event', status = 'associated'");
    expect((await reader().list("owner", { view: "needs_attention" })).items[0]?.amountCents).toBe(expected);
    expect((await reader().detail("owner", { owner: "event", id: "pending-event" }))?.amountCents).toBe(expected);
  });
  it.each(["expense", "income"] as const)("uses owner-confirmed %s direction ahead of original source classification", async (kind) => {
    const sourceType = kind === "expense" ? "income" : "expense";
    await db.execute({ sql: `INSERT INTO ea_financial_documents
      (user_id, account_id, email_uid, status, candidate_json, created_at, updated_at)
      VALUES ('owner', 'mail', 'confirmed-source', 'retry', ?, 1, 1)`,
      args: [JSON.stringify({ type: sourceType, amount: 30, currency: "USD", amount_kind: "transaction_amount" })] });
    const store = createFinancialEventStore(db, () => 1000);
    const document = await store.getDocumentForEmail("owner", "confirmed-source");
    await createFinancialEventCompletion({ store, now: () => 1000 }).complete("owner", {
      emailUid: "confirmed-source", documentRevision: document!.revision, eventRevision: null,
      entry: { kind, amount: 42, date: "2026-09-01", accountId: "account", payee: "Confirmed merchant" },
    });
    const confirmed = await store.getEventForEmail("owner", "confirmed-source");
    const detail = await reader().detail("owner", { owner: "event", id: confirmed!.id });
    expect(detail).toMatchObject({ status: "processing", amountCents: kind === "income" ? 4200 : -4200,
      completionPlan: { candidate: { type: kind, amount: 42 } } });
    expect((await reader().list("owner")).items[0]?.amountCents).toBe(detail!.amountCents);
    expect(await reader().list("owner", { view: "needs_attention" })).toMatchObject({
      items: [{ reference: detail!.reference, status: "processing" }], total: 1, attentionTotal: 0,
    });
    expect((await reader().list("owner", { view: "completed" })).total).toBe(0);
    await db.execute({ sql: `UPDATE ea_financial_events SET status = 'settled',
      outcome_json = '{"outcome":"already_present"}' WHERE id = ?`, args: [confirmed!.id] });
    expect((await reader().list("owner", { view: "needs_attention" })).total).toBe(0);
    expect((await reader().list("owner", { view: "completed" })).items[0]?.reference).toEqual(detail!.reference);
  });
  it.each([
    ["transaction", -2500, -2500], ["transaction", 2500, 2500],
    ["completed_transfer", 2500, -2500], ["transfer_schedule", 2500, -2500],
  ] as const)("preserves signed captured %s amounts (%s cents)", async (kind, amountCents, expected) => {
    await event("captured-direction");
    const operation = { executor: kind === "transfer_schedule" ? "transfer_schedule" : "financial",
      input: { ...(kind === "transfer_schedule" ? {} : { kind }), amountCents, budgetId: "budget" } };
    await db.execute({ sql: `UPDATE ea_financial_events SET status = 'settled', attempted_at = 2,
      operation_json = ?, outcome_json = '{"outcome":"added","budgetId":"budget"}' WHERE id = 'captured-direction'`, args: [JSON.stringify(operation)] });
    expect((await reader().detail("owner", { owner: "event", id: "captured-direction" }))?.amountCents).toBe(expected);
    expect((await reader().list("owner", { view: "completed" })).items[0]?.amountCents).toBe(expected);
  });
  it.each(["expense", "income", "bill", "transfer_schedule"] as const)("signs captured %s plan amounts when an existing entry needs no new operation", async (kind) => {
    await event("matched-direction");
    const plan = ownerCompletionPlan("matched-direction", { kind, amount: 25, date: "2026-09-01", accountId: "account",
      fromAccountId: "account", toAccountId: "destination", payee: "Original merchant" });
    await db.execute({ sql: `UPDATE ea_financial_events SET status = 'settled', plan_json = ?,
      outcome_json = '{"outcome":"already_present","budgetId":"budget"}' WHERE id = 'matched-direction'`, args: [JSON.stringify(plan)] });
    expect((await reader().detail("owner", { owner: "event", id: "matched-direction" }))?.amountCents).toBe(kind === "income" ? 2500 : -2500);
  });
  it("filters and pages one mixed-owner snapshot without truncating either source", async () => {
    for (let i = 0; i < 25; i++) {
      await item(`i${i}`, { createdAt: i * 2 });
      await event(`e${i}`, i * 2 + 1);
    }
    await event("private", 1000, "other");
    await event("negative", 1000, "owner", "settled");
    const first = await reader().list("owner", { view: "needs_attention" });
    const second = await reader().list("owner", { view: "needs_attention", offset: 20 });
    const last = await reader().list("owner", { view: "needs_attention", offset: 40 });
    expect([first.total, second.total, last.total]).toEqual([50, 50, 50]);
    expect([first.attentionTotal, second.attentionTotal, last.attentionTotal]).toEqual([50, 50, 50]);
    expect((await reader().list("owner", { source: "amazon" })).attentionTotal).toBe(25);
    expect(first.items.slice(0, 2).map((entry) => entry.reference.id)).toEqual(["e24", "i24"]);
    expect(new Set([...first.items, ...second.items, ...last.items].map((entry) => entry.id)).size).toBe(50);
    expect((await reader().list("owner", { source: "amazon" })).total).toBe(25);
    expect((await reader().detail("owner", { owner: "import", id: "i0", runId: "run-i0" }))?.reference.id).toBe("i0");
    expect(await reader().detail("owner", { owner: "import", id: "i0", runId: "run-i1" })).toBeNull();
    expect(await reader().detail("other", { owner: "import", id: "i0", runId: "run-i0" })).toBeNull();
  });
  it("preserves original imported identity and each run occurrence across parser changes", async () => {
    await item("first", { trigger: "historical_scan", importedId: "order-1", candidateKey: "order", messageId: "receipt" });
    await item("repeat", { importedId: "order-1", candidateKey: "v2-order", messageId: "receipt2", trigger: "arrival" });
    await item("parser-change", { importedId: "new-parser-id", candidateKey: "order", messageId: "receipt" });
    await item("next-month", { importedId: "order-2", candidateKey: "second-order", messageId: "receipt" });
    const list = await reader().list("owner");
    expect(list.total).toBe(2);
    const detail = await reader().detail("owner", { owner: "import", id: "repeat", runId: "run-repeat" });
    expect(detail?.occurrences).toHaveLength(3);
    expect(new Set(detail?.contexts)).toEqual(new Set(["arrival", "historical_scan"]));
    expect((await reader().list("owner", { runId: "run-parser-change" })).total).toBe(1);
  });
  it("retains immutable original receipts while current owner state changes", async () => {
    await event("saved");
    const result = { outcome: "updated", budgetId: "budget", evidence: { budgetId: "budget", objects: [
      { kind: "schedule", id: "schedule", role: "primary", provenance: "updated", before: { amount: -1000 }, after: { amount: -2000 } },
    ] } };
    await db.execute({ sql: "UPDATE ea_financial_events SET status = 'settled', outcome_json = ? WHERE id = 'saved'", args: [JSON.stringify(result)] });
    await db.execute({ sql: "UPDATE ea_financial_events SET outcome_json = ? WHERE id = 'saved'", args: [JSON.stringify({ outcome: "already_present", budgetId: "other-budget" })] });
    db.close();
    db = createClient({ url: `file:${directory}/history.db` });
    const detail = await reader().detail("owner", { owner: "event", id: "saved" });
    expect(detail?.originalReceipts[0]?.result).toEqual(result);
    expect(detail?.effectiveResult).toEqual(result);
    expect(detail?.liveState).toBe("not_checked");
    await expect(db.execute("UPDATE ea_financial_original_receipts SET outcome = 'added'")).rejects.toThrow(/immutable/);
    const bindings = await db.execute("SELECT budget_id, object_id FROM ea_financial_actual_bindings");
    expect(bindings.rows.map((row) => [row.budget_id, row.object_id])).toEqual([["budget", "schedule"]]);
  });
  it("keeps document links valid after association and source email removal", async () => {
    await db.execute("INSERT INTO ea_financial_documents (user_id, account_id, email_uid, status, candidate_json, last_error, created_at, updated_at) VALUES ('owner', 'mail', 'missing-email', 'retry', '{}', 'Waiting for an explicit transaction or payment date.', 1, 1)");
    const before = (await reader().list("owner")).items[0]!;
    expect(before.reference.owner).toBe("document");
    await db.execute("UPDATE ea_financial_documents SET status = 'ignored'");
    expect((await reader().list("owner")).total).toBe(0);
    expect((await reader().detail("owner", before.reference))?.status).toBe("dismissed");
    await event("associated");
    await db.execute("UPDATE ea_financial_documents SET event_id = 'associated', status = 'associated'");
    expect((await reader().detail("owner", before.reference))?.reference).toEqual({ owner: "event", id: "associated" });
  });
  it("returns related sources and every admitted correction on one owner-scoped record", async () => {
    await event("chain");
    for (const [uid, date] of [["notice", "2026-01-01T10:00:00Z"], ["revised", "2026-01-01T10:10:00Z"]]) {
      await db.execute({ sql: `INSERT INTO ea_email_index (uid,user_id,account_id,account_label,account_email,subject,email_date,email_date_utc)
        VALUES (?,'owner','mail','Mail','owner@example.com',? ,?,?)`, args: [uid!, `Bill ${uid}`, date!, date!] });
      await db.execute({ sql: `INSERT INTO ea_financial_documents (user_id,account_id,email_uid,event_id,status,candidate_json,created_at,updated_at)
        VALUES ('owner','mail',?,'chain','associated','{}',1000,1000)`, args: [uid!] });
    }
    await db.execute(`UPDATE ea_financial_events SET status='settled',outcome_json='{"outcome":"updated"}',updated_at=2000 WHERE id='chain'`);
    const activityId = JSON.stringify(["event", "chain"]);
    for (const [id,state,previous,updatedAt] of [["first","superseded",null,3000], ["second","completed","first",4000]] as const) {
      await db.execute({ sql: `INSERT INTO ea_financial_correction_previews VALUES (?,'owner',?,'{}',2500)`, args:[id,activityId] });
      await db.execute({ sql: `INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,predecessor_id,state,updated_at)
        VALUES (?,'owner',?,'budget',?,?,?,?,?)`, args:[id,activityId,id,id,previous,state,updatedAt] });
      await db.execute({ sql: `INSERT INTO ea_financial_correction_steps (correction_id,position,step_json,attempted_at,state)
        VALUES (?,0,'{}',?,?)`, args:[id,updatedAt-100,id === 'first' ? 'partial' : 'applied'] });
    }
    const detail = await reader().detail("owner", { owner:"event",id:"chain" });
    expect(detail?.history).toEqual({
      emails:[{ uid:"notice",subject:"Bill notice",receivedAt:Date.parse("2026-01-01T10:00:00Z") },{ uid:"revised",subject:"Bill revised",receivedAt:Date.parse("2026-01-01T10:10:00Z") }],
      corrections:[{ id:"first",predecessorId:null,state:"superseded",updatedAt:3000,steps:[{ state:"partial",attemptedAt:2900 }] },{ id:"second",predecessorId:"first",state:"completed",updatedAt:4000,steps:[{ state:"applied",attemptedAt:3900 }] }],
    });
    expect(detail?.originalReceipts).toHaveLength(1);
    expect(detail?.correction?.id).toBe("second");
    expect((await reader().list("owner")).items).toMatchObject([{ id:activityId }]);
    expect((await reader().list("owner")).items[0]?.history).toBeUndefined();
    expect(await reader().detail("other", { owner:"event",id:"chain" })).toBeNull();
    await db.execute("DELETE FROM ea_email_index WHERE uid='notice'");
    expect((await reader().detail("owner", { owner:"event",id:"chain" }))?.history?.emails[0]).toEqual({ uid:"notice",subject:"Source email",receivedAt:null });
  });
  it.each([['payment', -2500], ['income', 2500], ['transfer', -2500], ['bill', -2500]])('preserves %s direction after a correction', async (type, expected) => {
    await event('signed', 1000, 'owner', 'settled');
    await db.execute(`UPDATE ea_financial_events SET outcome_json='{"outcome":"updated"}' WHERE id='signed'`);
    const activityId=JSON.stringify(['event','signed']);
    await db.execute({sql:"INSERT INTO ea_financial_correction_previews VALUES ('signed-correction','owner',?,'{}',2000)",args:[activityId]});
    await db.execute({sql:`INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at)
      VALUES ('signed-correction','owner',?,'budget','signed-correction','signed','completed',?,3000)`,args:[activityId,JSON.stringify({entry:{type,amountCents:2500}})]});
    expect((await reader().detail('owner',{owner:'event',id:'signed'}))?.amountCents).toBe(expected);
    expect((await reader().list('owner',{view:'completed'})).items[0]?.amountCents).toBe(expected);
  });
  it.each([undefined, { type: 'income', amountCents: 3700, date: '2026-09-07' }])('projects kept observed results without rewriting conflict history: %j', async (entry) => {
    await event('kept', 1000, 'owner', 'settled');
    await db.execute(`UPDATE ea_financial_events SET outcome_json='{"outcome":"updated"}' WHERE id='kept'`);
    const activityId = JSON.stringify(['event', 'kept']);
    const effectiveResult = { outcome: 'kept', resolution: 'kept_actual', ...(entry ? { entry } : {}), snapshot: {}, evidence: { budgetId: 'budget', objects: [] } };
    await db.execute({ sql: "INSERT INTO ea_financial_correction_previews VALUES ('kept-correction','owner',?,'{}',2000)", args: [activityId] });
    await db.execute({ sql: `INSERT INTO ea_financial_corrections (id,user_id,activity_id,budget_id,preview_id,idempotency_key,state,effective_result_json,updated_at)
      VALUES ('kept-correction','owner',?,'budget','kept-correction','kept','completed',?,3000)`, args: [activityId, JSON.stringify(effectiveResult)] });
    await db.execute("INSERT INTO ea_financial_correction_steps (correction_id,position,step_json,attempted_at,state) VALUES ('kept-correction',0,'{}',2500,'conflict')");
    const detail = await reader().detail('owner', { owner: 'event', id: 'kept' });
    expect(detail).toMatchObject({ status: 'completed', amountCents: entry?.amountCents ?? null, effectiveResult,
      correction: { resolution: 'kept_actual' }, history: { corrections: [{ resolution: 'kept_actual', steps: [{ state: 'conflict', attemptedAt: 2500 }] }] } });
    expect((await reader().list('owner', { view: 'needs_attention' })).total).toBe(0);
    expect((await reader().list('owner', { view: 'completed' })).items[0]?.amountCents).toBe(entry?.amountCents ?? null);
  });
  it("keeps automatic retries and processing visible without adding to the actionable count", async () => {
    await event("retry");
    await db.execute("UPDATE ea_financial_events SET reason = 'Financial processing is paused while email AI is disabled.'");
    await event("pending", 1000, "owner", "pending");
    expect(await reader().list("owner", { view: "needs_attention" })).toMatchObject({
      total: 2, attentionTotal: 0, items: [{ status: "processing" }, { status: "processing" }],
    });
    expect((await reader().list("owner", { view: "completed" })).total).toBe(0);
  });
  it("binds only the original owner-scoped identity and preserves unknown old provenance", async () => {
    await item("old", { importedId: "original-imported-id" });
    const reference = { owner: "import" as const, id: "old", runId: "run-old" };
    const resolve = createFinancialActivityBinding({ dbClient: db, inspect: async (owner, budget, account, importedId) => {
      if (owner !== "owner" || account !== "card" || importedId !== "original-imported-id") return { status: "missing", evidence: null };
      return { status: "resolved", evidence: { budgetId: budget, objects: [{ kind: "transaction", id: "exact-target", role: "primary",
        provenance: "unknown", beforeState: "unknown", before: null, after: { id: "exact-target", amount: -1000 } }] } };
    } });
    await db.execute("UPDATE ea_transaction_import_items SET imported_id = 'edited-imported-id', actual_account_id = 'edited-account' WHERE id = 'old'");
    expect((await resolve("owner", reference, "budget")).status).toBe("resolved");
    const detail = await reader().detail("owner", reference);
    expect(detail?.targetBindings).toMatchObject([{ budgetId: "budget", objects: [{ id: "exact-target", provenance: "unknown", before: null }] }]);
    expect((await resolve("owner", reference, "different-budget")).status).toBe("wrong_budget");
    await expect(resolve("other", reference, "budget")).rejects.toMatchObject({ status: 404 });
    const replaced = createFinancialActivityBinding({ dbClient: db, inspect: async (_owner, budget, _account, _imported, targetId) => targetId === "exact-target"
      ? { status: "missing", evidence: null }
      : { status: "resolved", evidence: { budgetId: budget, objects: [{ kind: "transaction", id: "replacement", role: "primary", provenance: "unknown", beforeState: "unknown", before: null, after: null }] } } });
    expect(await replaced("owner", reference, "budget")).toEqual({ status: "missing", evidence: null });
    expect((await reader().detail("owner", reference))?.targetBindings[0]?.objects).toHaveLength(1);
    const unavailable = createFinancialActivityBinding({ dbClient: db, inspect: async () => { throw new Error("offline"); } });
    expect(await unavailable("owner", reference, "budget")).toEqual({ status: "unavailable", evidence: null });
  });

  it("captures a verified write even when changed source evidence requires attention", async () => {
    await event("conflicted");
    const operation = { executor: "financial", input: { kind: "transaction", payee: "Original", amountCents: -2500, budgetId: "budget" },
      sourceEvidence: [{ emailUid: "original-email", revision: 1, candidate: { amount: 25 } }] };
    await db.execute({ sql: `UPDATE ea_financial_events SET status = 'needs_review', attempted_at = 2, operation_json = ?, outcome_json = ? WHERE id = 'conflicted'`,
      args: [JSON.stringify(operation), JSON.stringify({ outcome: "added", budgetId: "budget", transactionId: "exact" })] });
    await db.execute({ sql: "UPDATE ea_financial_events SET plan_json = ? WHERE id = 'conflicted'", args: [JSON.stringify({ candidate: { payee: "Changed", amount: 99 } })] });
    const detail = await reader().detail("owner", { owner: "event", id: "conflicted" });
    expect(detail).toMatchObject({ status: "needs_attention", payee: "Original", amountCents: -2500,
      sourceEvidence: operation.sourceEvidence });
    expect(detail?.originalReceipts).toHaveLength(1);
  });
  it("quarantines contradictory aliases without changing either established identity", async () => {
    await item("a", { importedId: "import-a", messageId: "message-a", candidateKey: "candidate-a" });
    await item("b", { importedId: "import-b", messageId: "message-b", candidateKey: "candidate-b" });
    await item("conflict", { importedId: "import-b", messageId: "message-a", candidateKey: "candidate-a" });
    expect((await reader().list("owner")).total).toBe(3);
    const detail = await reader().detail("owner", { owner: "import", id: "conflict", runId: "run-conflict" });
    expect(detail).toMatchObject({ status: "needs_attention", actions: { complete: false, retry: false } });
    expect(detail?.reason).toMatch(/aliases conflict/);
  });

  it("admits only one selected budget when old binding inspections race", async () => {
    await item("racing");
    const resolve = createFinancialActivityBinding({ dbClient: db, inspect: async (_owner, budget) => ({ status: "resolved",
      evidence: { budgetId: budget, objects: [{ kind: "transaction", id: `target-${budget}`, role: "primary", provenance: "unknown", beforeState: "unknown", before: null, after: null }] } }) });
    const reference = { owner: "import" as const, id: "racing", runId: "run-racing" };
    const results = await Promise.all([resolve("owner", reference, "budget-a"), resolve("owner", reference, "budget-b")]);
    expect(results.map((result) => result.status).sort()).toEqual(["resolved", "wrong_budget"]);
    expect((await reader().detail("owner", reference))?.targetBindings).toHaveLength(1);
  });

  it("retains historical source inspection without original execution actions", async () => {
    await item("retired", { trigger: "historical_scan" });
    const detail = await reader().detail("owner", { owner: "import", id: "retired", runId: "run-retired" });
    expect(detail).toMatchObject({ status: "dismissed", actions: { complete: false, retry: false, inspect: true } });
    expect(detail?.sourceEvidence).toHaveLength(1);
  });

  it("retains an attempted import preparation and refuses to rewrite its source fields", async () => {
    await item("attempt");
    const store = createTransactionImportStore(db, () => 2000);
    const fields = { date: "2026-09-01", amountCents: -1000, payee: "Original", notes: "", actualAccountId: "card", actualCategoryId: null };
    expect(await store.confirmItem("owner", "run-attempt", "attempt", fields)).toBe(true);
    const preview = (await store.claimNextItem("preview"))!;
    await store.settleItem("owner", "attempt", preview.claimToken, { status: "ready" });
    const claim = (await store.claimNextItem("write"))!;
    expect(await store.admitOriginalImport(claim, { budgetId: "original-budget", objects: [] })).toBe(true);
    await store.settleItem("owner", "attempt", claim.claimToken, { status: "failed", lastError: "Response lost" });
    expect(await store.confirmItem("owner", "run-attempt", "attempt", { ...fields, amountCents: -9999 })).toBe(false);
    expect(await store.getItem("owner", "attempt")).toMatchObject({ amountCents: -1000, originalAttemptedAt: 2000,
      preparedEvidence: { budgetId: "original-budget", objects: [] } });
    expect(await store.retryItem("owner", "attempt")).toBe(true);
    const recovery = (await store.claimNextItem("recovery"))!;
    expect(await store.admitOriginalImport(recovery, { budgetId: "different-budget", objects: [] })).toBe(false);
  });

});
