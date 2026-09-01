import { createClient, type InStatement } from "@libsql/client";
import { describe, expect, it, vi } from "vitest";
import { resolveBillPaySeed } from "./bill-pay-service.ts";
import { semanticTargetPolicies } from "./billSemanticEventPolicy.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";

async function createBillCandidateDb() {
  const client = createClient({ url: "file::memory:" });
  await client.executeMultiple(`
    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      bill_pay_mappings_json TEXT,
      bill_extract_provider TEXT,
      bill_extract_model TEXT
    );
    CREATE TABLE ea_email_triage (
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      email_id TEXT NOT NULL,
      bill_candidate_json TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, account_id, email_id)
    );
    CREATE TABLE ea_email_index (
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      uid TEXT NOT NULL,
      from_name TEXT,
      from_address TEXT,
      subject TEXT,
      body_snippet TEXT,
      body_text TEXT
    );
  `);
  const mappings = {
    version: 2,
    profiles: [{
      id: "costco",
      identity: { domain: ["costco.com"] },
      behaviors: [
        { id: "fuel", name: "Fuel", type: "expense", targets: { category_id: "fuel", category_label: "Fuel" } },
        { id: "warehouse", name: "Warehouse", type: "expense", targets: { category_id: "warehouse", category_label: "Warehouse" } },
      ],
    }],
  };
  await client.execute({
    sql: "INSERT INTO ea_settings VALUES (?, ?, ?, ?)",
    args: ["u1", JSON.stringify(mappings), "openai", "gpt-5.4-mini"],
  });
  await client.execute({
    sql: "INSERT INTO ea_email_index VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: ["u1", "gmail", "msg-1", "Costco", "orders@costco.com", "Your order", "Order total $84.12", "Costco warehouse order total $84.12"],
  });
  return client;
}

const currentMetadata = async () => ({
  accounts: [],
  payees: [],
  payeeMap: {},
  categories: [{ id: "fuel", name: "Fuel" }, { id: "warehouse", name: "Warehouse" }],
  schedules: [],
  recentTransactions: [],
  syncHealth: { state: "current", lastSuccessAt: "2026-08-31T12:00:00.000Z" },
}) as never;

describe("resolveBillPaySeed Actual reconciliation", () => {
  it("compare-and-swap persists historical enrichment once and reuses it on the next read", async () => {
    const dbClient = await createBillCandidateDb();
    const originalCandidate = {
      payee_hint: "Costco",
      amount: 84.12,
      amount_kind: "order_total",
      amount_candidates: [{ kind: "order_total", value: 84.12 }],
      event_kind: "purchase",
      event_confidence: 0.99,
      event_evidence: "warehouse order",
    };
    await dbClient.execute({
      sql: "INSERT INTO ea_email_triage VALUES (?, ?, ?, ?, datetime('now'))",
      args: ["u1", "gmail", "msg-1", JSON.stringify(originalCandidate)],
    });
    const selectEmailTargetPolicy = vi.fn(async ({ candidate, behaviors }) => {
      const key = semanticTargetPolicies(behaviors, candidate).policies
        .find((policy) => policy.behavior.id === "warehouse")!.key;
      return {
        ...candidate,
        target_policy_key: key,
        target_confidence: 0.99,
        target_evidence: "warehouse order",
        target_verification: { status: "selected", option_count: 2, provider: "openai", model: "gpt-5.4-mini" },
      };
    });
    const candidateVerification = {
      verifyEmailCandidate: async ({ candidate }: { candidate: BillCandidate }) => candidate,
      selectEmailTargetPolicy,
    };
    const healthEvents: unknown[] = [];
    const options = {
      metadataReader: currentMetadata,
      occurrenceReader: async () => ({ schedules: [] }),
      transactionReader: async () => ({ transactions: [] }),
      candidateVerification: candidateVerification as never,
      emitSemanticHealthTelemetry: (event: unknown) => healthEvents.push(event),
    };

    const first = await resolveBillPaySeed("u1", { emailId: "msg-1", accountId: "gmail", dbClient }, options);
    const second = await resolveBillPaySeed("u1", { emailId: "msg-1", accountId: "gmail", dbClient }, options);
    const stored = await dbClient.execute("SELECT bill_candidate_json FROM ea_email_triage");
    const persisted = JSON.parse(String(stored.rows[0]!.bill_candidate_json));

    expect(first.mapping).toMatchObject({ status: "matched", behaviorId: "warehouse" });
    expect(second.mapping).toMatchObject({ status: "matched", behaviorId: "warehouse" });
    expect(persisted).toMatchObject({
      category_id: "warehouse",
      target_verification: { status: "selected" },
      semantic_enrichment: { status: "complete" },
    });
    expect(healthEvents).toMatchObject([
      { event: "bill_semantic_health", enrichment_persistence: "newly_persisted" },
      { event: "bill_semantic_health", enrichment_persistence: "already_persisted" },
    ]);
    // test-architecture: allow-boundary-interaction -- Target selection is the outbound AI-provider boundary; one call across two reads proves durable enrichment prevents repeat model spend.
    expect(selectEmailTargetPolicy).toHaveBeenCalledTimes(1);
    await dbClient.close();
  });

  it("reloads the durable winner when historical enrichment loses its compare-and-swap", async () => {
    const client = await createBillCandidateDb();
    const originalCandidate: BillCandidate = {
      payee_hint: "Costco",
      amount: 84.12,
      amount_kind: "order_total",
      amount_candidates: [{ kind: "order_total", value: 84.12 }],
      event_kind: "purchase",
      event_confidence: 0.99,
      event_evidence: "warehouse order",
    };
    await client.execute({
      sql: "INSERT INTO ea_email_triage VALUES (?, ?, ?, ?, datetime('now'))",
      args: ["u1", "gmail", "msg-1", JSON.stringify(originalCandidate)],
    });
    const behaviors = [
      { id: "fuel", name: "Fuel", type: "expense", targets: { category_id: "fuel", category_label: "Fuel" } },
      { id: "warehouse", name: "Warehouse", type: "expense", targets: { category_id: "warehouse", category_label: "Warehouse" } },
    ];
    const fuelPolicyKey = semanticTargetPolicies(behaviors, originalCandidate).policies
      .find((policy) => policy.behavior.id === "fuel")!.key;
    const durableWinner: BillCandidate = {
      ...originalCandidate,
      payee_hint: "Concurrent winner",
      category_id: "fuel",
      category_label: "Fuel",
      target_policy_key: fuelPolicyKey,
      target_confidence: 0.98,
      target_evidence: "fuel purchase",
      target_verification: { status: "selected", option_count: 2, provider: "openai", model: "gpt-5.4-mini" },
      semantic_enrichment: { status: "complete", provider: "openai", model: "gpt-5.4-mini" },
    };
    let intercepted = false;
    const healthEvents: unknown[] = [];
    const racingDb = {
      execute: async (statement: InStatement) => {
        const sql = typeof statement === "string" ? statement : statement.sql;
        if (!intercepted && sql.includes("UPDATE ea_email_triage") && sql.includes("bill_candidate_json = ?")) {
          intercepted = true;
          await client.execute({
            sql: "UPDATE ea_email_triage SET bill_candidate_json = ? WHERE user_id = ? AND account_id = ? AND email_id = ?",
            args: [JSON.stringify(durableWinner), "u1", "gmail", "msg-1"],
          });
        }
        return client.execute(statement);
      },
    };
    const selectEmailTargetPolicy = vi.fn(async ({ candidate }: { candidate: BillCandidate }) => ({
      ...candidate,
      category_id: "warehouse",
      category_label: "Warehouse",
      target_policy_key: semanticTargetPolicies(behaviors, candidate).policies
        .find((policy) => policy.behavior.id === "warehouse")!.key,
      target_confidence: 0.99,
      target_evidence: "warehouse order",
      target_verification: { status: "selected" as const, option_count: 2, provider: "openai", model: "gpt-5.4-mini" },
    }));

    const result = await resolveBillPaySeed("u1", {
      emailId: "msg-1",
      accountId: "gmail",
      dbClient: racingDb,
    }, {
      metadataReader: currentMetadata,
      occurrenceReader: async () => ({ schedules: [] }),
      transactionReader: async () => ({ transactions: [] }),
      candidateVerification: {
        verifyEmailCandidate: async ({ candidate }: { candidate: BillCandidate }) => candidate,
        selectEmailTargetPolicy,
      } as never,
      emitSemanticHealthTelemetry: (event: unknown) => healthEvents.push(event),
    });
    const stored = await client.execute("SELECT bill_candidate_json FROM ea_email_triage");

    expect(result.mapping).toMatchObject({ status: "matched", behaviorId: "fuel" });
    expect(result.bill).toMatchObject({ payee_hint: "Concurrent winner", category_id: "fuel" });
    expect(JSON.parse(String(stored.rows[0]!.bill_candidate_json))).toMatchObject({
      payee_hint: "Concurrent winner",
      category_id: "fuel",
    });
    expect(healthEvents).toMatchObject([
      { event: "bill_semantic_health", enrichment_persistence: "cas_lost" },
    ]);
    await client.close();
  });

  it("returns the canonical Actual status alongside the resolved bill seed", async () => {
    const dbClient = {
      execute: vi.fn().mockResolvedValue({ rows: [{ bill_pay_mappings_json: null }] }),
    };
    const metadataReader = vi.fn().mockResolvedValue({
      schedules: [{
        id: "schedule-acme",
        name: "Acme Utilities",
        next_date: "2026-08-12",
        completed: false,
        type: "bill",
        conditions: [
          { op: "is", field: "payee", value: "payee-acme" },
          { op: "is", field: "account", value: "checking" },
          { op: "is", field: "amount", value: -14231 },
        ],
      }],
      accounts: [{ id: "checking", name: "Checking" }],
      payeeMap: { "payee-acme": "Acme Utilities" },
      syncHealth: { state: "current", lastSuccessAt: "2026-07-16T16:00:00.000Z" },
    });
    const occurrenceReader = async (
      userId: string,
      range: { start: string; end: string },
      options: { dbClient: unknown },
    ) => ({
      schedules: userId === "u1"
        && range.start === "2026-08-12"
        && range.end === "2026-08-12"
        && options.dbClient === dbClient
        ? [{
            scheduleId: "schedule-acme",
            name: "Acme Utilities",
            amount: 142.31,
            next_date: "2026-08-12",
            paid: false,
            type: "bill",
          }]
        : [],
      syncHealth: { state: "current", lastSuccessAt: "2026-07-16T16:00:00.000Z" },
    });
    const transactionReader = async () => {
      throw new Error("future scheduled bills must not read exact transactions");
    };

    const result = await resolveBillPaySeed("u1", {
      candidate: {
        type: "bill",
        payee: "Acme Utilities",
        payee_id: "payee-acme",
        account_id: "checking",
        amount: 142.31,
        due_date: "2026-08-12",
      },
      source: "triage",
      dbClient,
    }, {
      metadataReader,
      occurrenceReader,
      transactionReader,
      now: new Date("2026-07-16T18:00:00.000Z"),
    });

    expect(result.actualStatus).toMatchObject({
      status: "already_scheduled",
      evidence: { scheduleId: "schedule-acme" },
    });
  });
});
