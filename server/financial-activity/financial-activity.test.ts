import { createClient, type Client } from "@libsql/client";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFinancialActivityBinding } from "./financial-activity-binding.ts";
import { createFinancialActivityReader } from "./financial-activity.ts";
import { createTransactionImportStore } from "../transaction-imports/transaction-import-store.ts";

const migrations = ["001_ea_tables.sql", "013_email_index_normalized_date.sql", "025_email_thread_identity.sql",
  "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql",
  "053_transaction_import_financial_plans.sql", "054_email_sender_authentication.sql", "055_generic_financial_email_imports.sql",
  "056_generic_financial_email_automation.sql", "058_generic_financial_email_income_automation.sql",
  "059_generic_financial_email_transfer_automation.sql", "062_financial_events.sql", "063_financial_activity.sql"];

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
    createdAt = 1000, trigger = "historical_scan" as "historical_scan" | "arrival" } = {}) {
    const store = createTransactionImportStore(db, () => createdAt);
    await store.createRun({ id: runId, userId: "owner", trigger, optionsKey: runId,
      gmailAccountIds: ["gmail"], sources: ["amazon"], ...(trigger === "historical_scan" ? { startDate: "2026-01-01", endDate: "2026-09-01" } : {}) });
    await store.insertItem({ id, runId, userId: "owner", gmailAccountId: "gmail", gmailMessageId: messageId,
      emailUid: `gmail-${messageId}`, candidateKey, source: "amazon", parserVersion: "v1", importedId,
      date: "2026-09-01", amountCents: -1000, currency: "USD", payee: "Market", actualAccountId: "card",
      automationMode: "observe", automaticSafe: false, blockingWarnings: [], evidence: [], status: "needs_review" });
  }
  async function event(id: string, createdAt = 1000, owner = "owner", status = "waiting") {
    await db.execute({ sql: `INSERT INTO ea_financial_events (id, user_id, status, reason, created_at, updated_at)
      VALUES (?, ?, ?, 'Waiting for an explicit transaction or payment date.', ?, ?)`, args: [id, owner, status, createdAt, createdAt] });
  }
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
    expect(first.items.slice(0, 2).map((entry) => entry.reference.id)).toEqual(["e24", "i24"]);
    expect(new Set([...first.items, ...second.items, ...last.items].map((entry) => entry.id)).size).toBe(50);
    expect((await reader().list("owner", { source: "amazon" })).total).toBe(25);
    expect((await reader().detail("owner", { owner: "import", id: "i0", runId: "run-i0" }))?.reference.id).toBe("i0");
    expect(await reader().detail("owner", { owner: "import", id: "i0", runId: "run-i1" })).toBeNull();
    expect(await reader().detail("other", { owner: "import", id: "i0", runId: "run-i0" })).toBeNull();
  });
  it("preserves original imported identity and each run occurrence across parser changes", async () => {
    await item("first", { importedId: "order-1", candidateKey: "order", messageId: "receipt" });
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
  it("keeps automatic retries and ordinary processing out of attention", async () => {
    await event("retry");
    await db.execute("UPDATE ea_financial_events SET reason = 'Financial processing is paused while email AI is disabled.'");
    await event("pending", 1000, "owner", "pending");
    expect((await reader().list("owner", { view: "needs_attention" })).total).toBe(0);
    expect((await reader().list("owner")).items.map((entry) => entry.status)).toEqual(["processing", "processing"]);
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
