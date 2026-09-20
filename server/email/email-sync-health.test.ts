import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEmailSyncHealth, recordEmailInboxCheck } from "./email-sync-health.ts";

const started = new Date("2026-09-14T12:00:00Z");
let database: Client;
async function account(id: string, userId = "owner", type = "gmail", email = `${id}@example.com`, updated = "2026-09-01") {
  await database.execute({
    sql: "INSERT INTO ea_accounts (id,user_id,type,email,label,updated_at) VALUES (?,?,?,?,?,?)",
    args: [id, userId, type, email, id, updated],
  });
}
async function health(now = started) { return getEmailSyncHealth("owner", { dbClient: database, now }); }
async function record(id: string, outcome: "started" | "success" | "failed", now = started) {
  return recordEmailInboxCheck("owner", id, outcome, { dbClient: database, now });
}
async function history(status: string, target = "200", error = "") {
  await database.execute({
    sql: `INSERT INTO ea_triage_jobs (user_id,account_id,job_type,status,idempotency_key,payload_json,last_error)
          VALUES ('owner','work','gmail_history_sync',?,?,?,?)`,
    args: [status, `${status}-${target}`, JSON.stringify({ historyId: target }), error],
  });
}
beforeEach(async () => {
  database = createClient({ url: "file::memory:" });
  for (const file of ["001_ea_tables.sql", "028_provider_needs_reauth.sql", "078_email_sync_health.sql"]) {
    await database.executeMultiple(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
  }
});
afterEach(() => database.close());

describe("email inbox health", () => {
  it("starts unknown, isolates accounts and expires Gmail at one hour while iCloud stays at 20 minutes", async () => {
    expect(await health()).toEqual([]);
    await account("work");
    await account("personal", "owner", "icloud");
    await account("other", "someone-else");
    expect((await health()).map((row) => row.state)).toEqual(["unavailable", "unavailable"]);
    await record("work", "success");
    expect(await health(new Date(started.getTime() + 20 * 60_000 - 1))).toEqual([
      expect.objectContaining({ accountId: "work", state: "current", expiresAt: "2026-09-14T13:00:00.000Z" }),
      expect.objectContaining({ accountId: "personal", state: "unavailable", lastSuccessAt: null }),
    ]);
    await record("personal", "success");
    expect((await health(new Date("2026-09-14T12:19:59.999Z")))[1]).toMatchObject({ state: "current", expiresAt: "2026-09-14T12:20:00.000Z" });
    expect(await health(new Date("2026-09-14T12:20:00Z"))).toEqual([
      expect.objectContaining({ accountId: "work", state: "current" }),
      expect.objectContaining({ accountId: "personal", state: "needs_sync", message: "No successful inbox check in the last 20 minutes." }),
    ]);
    expect((await health(new Date("2026-09-14T12:59:59.999Z")))[0]!.state).toBe("current");
    expect((await health(new Date("2026-09-14T13:00:00Z")))[0]).toMatchObject({ state: "needs_sync", message: "No successful inbox check in the last 60 minutes." });
  });

  it("keeps failures visible during retries and recovers only on a successful check", async () => {
    await account("work");
    await record("work", "failed");
    expect((await health())[0]).toMatchObject({ state: "unavailable", severity: "error", lastSuccessAt: null });
    await record("work", "success");
    await record("work", "failed", new Date("2026-09-14T12:01:00Z"));
    await record("work", "started", new Date("2026-09-14T12:02:00Z"));
    expect((await health(new Date("2026-09-14T12:03:00Z")))[0]).toMatchObject({ state: "degraded", lastSuccessAt: started.toISOString() });
    await record("work", "success", new Date("2026-09-14T12:04:00Z"));
    expect((await health(new Date("2026-09-14T12:04:00Z")))[0]).toMatchObject({ state: "current", refreshStartedAt: null });
    await database.execute("UPDATE ea_accounts SET needs_reauth = 1 WHERE id = 'work'");
    expect((await health())[0]!.state).toBe("needs_reauth");
  });

  it("cannot erase pending or failed history ingestion with a successful recent inbox sweep", async () => {
    await account("work");
    await record("work", "success");
    await history("queued");
    expect((await health())[0]!.state).toBe("needs_sync");
    await database.execute("UPDATE ea_triage_jobs SET last_error = 'provider secret/raw error'");
    expect((await health())[0]).toMatchObject({ state: "degraded", message: "The latest inbox sync failed. Setpoint will retry automatically." });
    await database.execute("UPDATE ea_triage_jobs SET status = 'failed'");
    await record("work", "success", new Date("2026-09-14T12:05:00Z"));
    expect((await health())[0]!.state).toBe("degraded");
    await database.execute(`INSERT INTO ea_gmail_watch_state (user_id,account_id,email_address,last_history_id)
                            VALUES ('owner','work','work@example.com','201')`);
    expect((await health())[0]!.state).toBe("degraded");
    expect((await health())[0]).toMatchObject({ state: "degraded", message: "An earlier inbox sync failed and needs attention." });
    await database.execute("UPDATE ea_triage_jobs SET status = 'complete', last_error = ''");
    expect((await health())[0]!.state).toBe("current");
  });

  it("uses the canonical Gmail account and does not invent freshness from a watch timestamp", async () => {
    await account("old", "owner", "gmail", "WORK@example.com", "2026-09-01");
    await account("new", "owner", "gmail", "work@example.com", "2026-09-02");
    await record("old", "success");
    expect(await health()).toEqual([expect.objectContaining({ accountId: "new", state: "unavailable", lastSuccessAt: null })]);
  });

  it("reports a running check but never extends a previously successful check past its age limit", async () => {
    await account("work");
    await record("work", "started");
    expect((await health())[0]!.state).toBe("refreshing");
    expect((await health(new Date("2026-09-14T12:20:00Z")))[0]!.state).toBe("unavailable");
    await record("work", "success");
    await record("work", "started", new Date("2026-09-14T12:59:00Z"));
    expect((await health(new Date("2026-09-14T13:00:00Z")))[0]!.state).toBe("needs_sync");
  });

  it("surfaces a persistence outage instead of claiming there are no email accounts", async () => {
    await database.execute("DROP TABLE ea_accounts");
    await expect(health()).rejects.toThrow();
  });
});
