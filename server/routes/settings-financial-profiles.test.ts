import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import type { FinancialProfile } from "../../shared/types/financial-profiles.ts";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";

const state = vi.hoisted<{ db: Client | null }>(() => ({ db: null }));
function currentDb(): Client {
  if (!state.db) throw new Error("Test database is not initialized");
  return state.db;
}
// test-architecture: allow-boundary-mock -- all profile, settings, and Actual metadata modules use an ephemeral database through the real route.
vi.mock("../db/connection.ts", () => ({ default: {
  execute: (statement: InStatement) => currentDb().execute(statement),
  batch: (statements: Parameters<Client["batch"]>[0], mode?: TransactionMode) => currentDb().batch(statements, mode),
  transaction: (mode?: TransactionMode) => currentDb().transaction(mode),
} }));

const settingsRoutes = (await import("./settings.ts")).default;
const { readFinancialProfiles } = await import("../bills/financial-profiles.ts");

const profiles: FinancialProfile[] = [
  { id: "utility", name: "Electricity", enabled: true, budgetId: "budget-1", senderAddresses: [" BILLS@Utility.Example "], target: { kind: "utility", scheduleId: "utility-schedule" } },
  { id: "card", name: "Card payments", enabled: true, budgetId: "budget-1", senderAddresses: ["payments@card.example"], accountLast4: "1234", target: { kind: "card_payment", fromAccountId: "savings", toAccountId: "card", scheduleId: "card-schedule" } },
  { id: "expense", name: "Orders", enabled: true, budgetId: "budget-1", senderAddresses: ["receipts@shop.example"], merchantName: "Example Shop", target: { kind: "expense", accountId: "card", payeeId: "merchant", categoryId: "shopping" } },
  { id: "income", name: "Refunds", enabled: true, budgetId: "budget-1", senderAddresses: ["refunds@shop.example"], target: { kind: "income", accountId: "card", payeeId: "merchant", categoryId: null } },
];

const metadata: ActualMetadata = {
  accounts: [{ id: "savings", name: "Savings" }, { id: "card", name: "Card" }, { id: "closed", name: "Closed", closed: true }],
  // Both Actual metadata projections omit transfer payees but preserve schedule topology.
  payees: [{ id: "utility", name: "Utility" }, { id: "merchant", name: "Example Shop" }],
  categories: [{ categories: [{ id: "shopping", name: "Shopping" }] }],
  schedules: [
    { id: "utility-schedule", type: "bill", conditions: [{ field: "account", op: "is", value: "savings" }, { field: "payee", op: "is", value: "utility" }] },
    { id: "card-schedule", type: "transfer", transferAccountId: "savings", conditions: [{ field: "account", op: "is", value: "card" }, { field: "payee", op: "is", value: "transfer" }, { field: "amount", op: "is", value: 10000 }] },
    { id: "income-schedule", type: "income", conditions: [{ field: "account", op: "is", value: "savings" }, { field: "payee", op: "is", value: "merchant" }] },
    { id: "vague-schedule", type: "bill", conditions: [{ field: "account", op: "isnot", value: "savings" }, { field: "payee", op: "is", value: "utility" }] },
  ],
  payeeMap: { utility: "Utility", merchant: "Example Shop", transfer: "Savings" }, recentTransactions: [],
};

function app() {
  const result = express();
  result.use(express.json());
  result.use("/api/ea", settingsRoutes);
  return result;
}

async function seedMetadata() {
  await currentDb().execute({
    sql: `INSERT INTO ea_actual_metadata_mirror (user_id, status, accounts_json, payees_json, categories_json, schedules_json)
          VALUES (?, 'current', ?, ?, ?, ?)`,
    args: ["user-1", JSON.stringify(metadata.accounts), JSON.stringify(metadata.payees), JSON.stringify(metadata.categories), JSON.stringify(metadata.schedules)],
  });
}

beforeEach(async () => {
  vi.stubEnv("EA_USER_ID", "user-1");
  state.db = await createMigratedDb();
  await currentDb().execute({ sql: "INSERT INTO ea_settings (user_id, actual_budget_sync_id) VALUES (?, ?)", args: ["user-1", "budget-1"] });
});

afterEach(() => {
  state.db?.close();
  state.db = null;
  vi.unstubAllEnvs();
});

describe("financial profiles through Settings", () => {
  it("starts empty without adopting legacy mappings or Utilities membership", async () => {
    const legacy = JSON.stringify({ version: 2, profiles: [{ id: "old-mapping", enabled: true }] });
    await currentDb().execute({ sql: "UPDATE ea_settings SET bill_pay_mappings_json = ? WHERE user_id = ?", args: [legacy, "user-1"] });
    await currentDb().execute({
      sql: `INSERT INTO ea_finance_utilities (user_id, budget_id, id, label, provider, payee_id, schedule_ids_json, source_senders_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["user-1", "budget-1", "old-utility", "Electricity", "Utility", "utility", '["utility-schedule"]', '["bills@utility.example"]'],
    });
    const response = await request(app()).get("/api/ea/settings");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ financial_profiles: [], financial_profiles_revision: 0 });
    expect(response.body.bill_pay_mappings_json).toBeUndefined();
    expect((await currentDb().execute("SELECT bill_pay_mappings_json FROM ea_settings")).rows[0]?.bill_pay_mappings_json).toBe(legacy);
    expect(await readFinancialProfiles("absent-owner")).toEqual({ budgetId: null, revision: 0, profiles: [] });
  });

  it("saves projected card schedules without transfer payee rows and increments each successful save revision", async () => {
    await seedMetadata();
    const saved = await request(app()).put("/api/ea/settings").send({ financial_profiles: profiles });
    expect(saved.status).toBe(200);
    const normalized = profiles.map((profile) => ({ ...profile, senderAddresses: profile.senderAddresses.map((address) => address.trim().toLowerCase()) }));
    expect(await readFinancialProfiles("user-1")).toEqual({ budgetId: "budget-1", revision: 1, profiles: normalized });
    const responses = await Promise.all([0, 1].map(() => request(app()).put("/api/ea/settings").send({ financial_profiles: profiles })));
    expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
    const successfulSaves = responses.filter((response) => response.status === 200).length;
    expect(successfulSaves).toBeGreaterThanOrEqual(1);
    const read = await request(app()).get("/api/ea/settings");
    expect(read.body).toMatchObject({ financial_profiles: normalized, financial_profiles_revision: 1 + successfulSaves });
  });

  it("keeps disabled drafts when metadata or a prior budget's targets are unavailable", async () => {
    const draft: FinancialProfile = { ...profiles[0]!, enabled: false, budgetId: "old-budget", target: { kind: "utility", scheduleId: "removed-schedule" } };
    expect((await request(app()).put("/api/ea/settings").send({ financial_profiles: [draft] })).status).toBe(200);
    const saved = await readFinancialProfiles("user-1");
    expect(saved.profiles).toEqual([{ ...draft, senderAddresses: ["bills@utility.example"] }]);
    const enabled = await request(app()).put("/api/ea/settings").send({ financial_profiles: [{ ...draft, enabled: true }] });
    expect(enabled.status).toBe(400);
    expect(enabled.body.message).toContain("currently connected Actual budget");
    expect(await readFinancialProfiles("user-1")).toEqual(saved);
    const noMetadata = await request(app()).put("/api/ea/settings").send({ financial_profiles: profiles });
    expect(noMetadata.status).toBe(400);
    expect(noMetadata.body.message).toContain("metadata is unavailable");
  });

  it("allows one stale profile to be disabled while unchanged profiles retain their original budget binding", async () => {
    await seedMetadata();
    const original = [profiles[0]!, profiles[2]!];
    expect((await request(app()).put("/api/ea/settings").send({ financial_profiles: original })).status).toBe(200);
    await currentDb().execute("DELETE FROM ea_actual_metadata_mirror");
    await currentDb().execute({ sql: "UPDATE ea_settings SET actual_budget_sync_id = ? WHERE user_id = ?", args: ["new-budget", "user-1"] });
    const repaired = [{ ...original[0]!, name: "Electric bill" }, { ...original[1]!, enabled: false }];
    const disabled = await request(app()).put("/api/ea/settings").send({ financial_profiles: repaired });
    expect(disabled.status).toBe(200);
    expect(await readFinancialProfiles("user-1")).toMatchObject({ budgetId: "new-budget", revision: 2, profiles: [
      { id: "utility", name: "Electric bill", enabled: true, budgetId: "budget-1" }, { id: "expense", enabled: false },
    ] });
    const changedAuthority = [{ ...repaired[0]!, senderAddresses: ["other@utility.example"] }, repaired[1]!];
    expect((await request(app()).put("/api/ea/settings").send({ financial_profiles: changedAuthority })).status).toBe(400);
    const reenabled = [repaired[0]!, { ...repaired[1]!, enabled: true }];
    expect((await request(app()).put("/api/ea/settings").send({ financial_profiles: reenabled })).status).toBe(400);
    expect((await readFinancialProfiles("user-1")).revision).toBe(2);
  });

  it("rejects malformed, unbounded, wildcard, or behavior-bearing profiles without partially updating Settings", async () => {
    const draft = { ...profiles[0]!, enabled: false };
    const invalid: unknown[] = [
      null, "[]", {}, Array.from({ length: 101 }, (_, index) => ({ ...draft, id: String(index) })),
      [draft, draft], [{ ...draft, name: "n".repeat(121) }], [{ ...draft, enabled: "yes" }],
      [{ ...draft, senderAddresses: [] }], [{ ...draft, senderAddresses: ["*@utility.example"] }],
      [{ ...draft, senderAddresses: ["Utility <bills@utility.example>"] }],
      [{ ...draft, senderAddresses: ["BILLS@Utility.Example", "bills@utility.example"] }],
      [{ ...draft, senderAddresses: Array.from({ length: 21 }, (_, index) => `bills${index}@utility.example`) }],
      [{ ...draft, accountLast4: "12345" }], [{ ...draft, merchantName: "" }],
      [{ ...draft, rules: [{ when: ".*", action: "pay" }] }],
      [{ ...draft, target: { kind: "utility", scheduleId: "utility-schedule", fallback: "infer" } }],
      [{ ...draft, target: { kind: "card_payment", toAccountId: "card" } }],
    ];
    for (const financial_profiles of invalid) {
      const response = await request(app()).put("/api/ea/settings").send({ financial_profiles, email_lookback_hours: 24 });
      expect(response.status, JSON.stringify(financial_profiles)).toBe(400);
    }
    expect(await readFinancialProfiles("user-1")).toEqual({ budgetId: "budget-1", revision: 0, profiles: [] });
    expect((await request(app()).get("/api/ea/settings")).body.email_lookback_hours).toBe(16);
  });

  it("rejects enabled targets that cross budgets, use closed accounts, or misidentify schedule/payment direction", async () => {
    await seedMetadata();
    const invalid: FinancialProfile[] = [
      { ...profiles[0]!, budgetId: "other-budget" },
      ...["missing", "card-schedule", "income-schedule", "vague-schedule"].map((scheduleId) => ({ ...profiles[0]!, target: { kind: "utility" as const, scheduleId } })),
      { ...profiles[1]!, target: { kind: "card_payment", fromAccountId: "card", toAccountId: "card" } },
      { ...profiles[1]!, target: { kind: "card_payment", fromAccountId: "closed", toAccountId: "card" } },
      { ...profiles[1]!, target: { kind: "card_payment", fromAccountId: "card", toAccountId: "savings", scheduleId: "card-schedule" } },
      { ...profiles[2]!, target: { kind: "expense", accountId: "closed", payeeId: "merchant" } },
      { ...profiles[2]!, target: { kind: "expense", accountId: "card", payeeId: "transfer" } },
      { ...profiles[3]!, target: { kind: "income", accountId: "card", payeeId: "merchant", categoryId: "missing" } },
    ];
    for (const profile of invalid) {
      expect((await request(app()).put("/api/ea/settings").send({ financial_profiles: [profile] })).status).toBe(400);
    }
    expect((await readFinancialProfiles("user-1")).revision).toBe(0);
    const unboundCard = { ...profiles[1]!, target: { kind: "card_payment", fromAccountId: "savings", toAccountId: "card" } };
    expect((await request(app()).put("/api/ea/settings").send({ financial_profiles: [unboundCard] })).status).toBe(200);
  });
});
