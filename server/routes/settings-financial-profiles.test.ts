import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
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
const financesRoutes = (await import("./briefing/finances.ts")).default;
const { readFinancialProfiles } = await import("../bills/financial-profiles.ts");

function app() {
  const result = express();
  result.use(express.json());
  result.use("/api/ea", settingsRoutes);
  result.use("/api/briefing", financesRoutes);
  return result;
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

  it.each([false, true])('rejects retired financial writes atomically (migrated: %s)', async (migrated) => {
    const legacy = '[{"id":"archived-source"}]';
    await currentDb().execute({ sql: "UPDATE ea_settings SET financial_profiles_json=?, utility_pay_links_json=?, financial_profiles_revision=3 WHERE user_id='user-1'", args: [legacy, '[]'] });
    if (migrated) await currentDb().execute("INSERT INTO ea_financial_connection_state (user_id,revision,migrated_at,source_fingerprint) VALUES ('user-1',4,'2026-09-16','test')");
    const before = (await currentDb().execute("SELECT * FROM ea_settings WHERE user_id='user-1'")).rows;
    for (const update of [{ financial_profiles: [] }, { utility_pay_links: [] }]) {
      const response = await request(app()).put('/api/ea/settings').send({ ...update, weather_lat: 40 });
      expect(response.status).toBe(410);
      expect(response.body.message).toContain('Financial providers');
      expect((await currentDb().execute("SELECT * FROM ea_settings WHERE user_id='user-1'")).rows).toEqual(before);
    }
  });

  it('retires independent utility mapping routes while preserving archived membership', async () => {
    const before = (await currentDb().execute('SELECT * FROM ea_finance_utilities')).rows;
    expect((await request(app()).get('/api/briefing/finances/utility-mappings')).status).toBe(410);
    expect((await request(app()).put('/api/briefing/finances/utility-mappings/electricity').send({ budgetId: 'budget-1', payeeId: 'utility', scheduleIds: ['utility-schedule'] })).status).toBe(410);
    expect((await currentDb().execute('SELECT * FROM ea_finance_utilities')).rows).toEqual(before);
  });

  it('projects canonical settings without reading malformed archived pay links', async () => {
    await currentDb().execute("UPDATE ea_settings SET utility_pay_links_json='archived-invalid-json' WHERE user_id='user-1'");
    await currentDb().execute("INSERT INTO ea_financial_connection_state (user_id,revision,migrated_at,source_fingerprint) VALUES ('user-1',4,'2026-09-16','test')");
    const response = await request(app()).get('/api/ea/settings');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ financial_profiles: [], financial_profiles_revision: 4, utility_pay_links: [] });
  });
});
