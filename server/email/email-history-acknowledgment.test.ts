import { createClient, type Client } from "@libsql/client";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acknowledgeEmailHistoryFailures } from "./email-history-acknowledgment.ts";
import { getEmailSyncHealth, recordEmailInboxCheck } from "./email-sync-health.ts";

let db: Client;
let directory: string;
const now = new Date("2026-09-14T23:20:00Z");
const reason = "Reviewed legacy failure; historical completeness remains unknown.";
async function job(id: number, status = "failed", userId = "owner", jobType = "gmail_history_sync") {
  await db.execute({
    sql: `INSERT INTO ea_triage_jobs (id,user_id,account_id,job_type,status,idempotency_key,last_error,attempts,payload_json,updated_at)
          VALUES (?,?,'work',?,?,?,'constraint failed',1,'{"historyId":"123"}','2026-05-05 15:20:01')`,
    args: [id, userId, jobType, status, `job-${id}`],
  });
}
async function rows() { return (await db.execute("SELECT * FROM ea_triage_jobs ORDER BY id")).rows; }
async function acknowledge(jobIds: number[], expectedRevision?: string, note = reason) {
  return acknowledgeEmailHistoryFailures({ userId: "owner", jobIds, reason: note, expectedRevision }, { dbClient: db, now });
}
async function health() { return (await getEmailSyncHealth("owner", { dbClient: db, now }))[0]; }

beforeEach(async () => {
  directory = await createTestTempDir("email-history-ack-");
  db = createClient({ url: `file:${directory}/test.db` });
  for (const name of ["001_ea_tables.sql", "028_provider_needs_reauth.sql", "078_email_sync_health.sql", "079_email_history_acknowledgment.sql"]) {
    await db.executeMultiple(readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.execute("INSERT INTO ea_accounts (id,user_id,type,email,label) VALUES ('work','owner','gmail','work@example.com','Work')");
  await recordEmailInboxCheck("owner", "work", "success", { dbClient: db, now });
});
afterEach(async () => { db.close(); await removeTempDir(directory); });

describe("operator acknowledgment of historical Gmail failures", () => {
  it("previews without writes, restores current health and retains original failure evidence", async () => {
    await job(1);
    await job(2);
    const before = await rows();
    expect(await health()).toMatchObject({ state: "degraded" });
    const preview = await acknowledge([2, 1]);
    expect(preview.mode).toBe("dry-run");
    expect(await rows()).toEqual(before);
    await acknowledge([1, 2], preview.revision);
    const after = await rows();
    expect(after).toEqual(before.map((row) => ({ ...row, status: "acknowledged", acknowledged_at: now.toISOString(), acknowledgment_reason: reason })));
    expect(await health()).toMatchObject({ state: "current", lastSuccessAt: now.toISOString() });
    expect(await acknowledge([1, 2], preview.revision)).toMatchObject({ alreadyAcknowledged: true });
    expect(await rows()).toEqual(after);
    await expect(acknowledge([1, 2], preview.revision, "Changed reason")).rejects.toThrow("cannot be rewritten");
  });

  it("does not hide new failures, pending history, failed inbox checks or expired freshness", async () => {
    await job(1);
    const preview = await acknowledge([1]);
    await job(2);
    await acknowledge([1], preview.revision);
    expect(await health()).toMatchObject({ state: "degraded" });
    await db.execute("UPDATE ea_triage_jobs SET status='queued',last_error='' WHERE id=2");
    expect(await health()).toMatchObject({ state: "needs_sync" });
    await db.execute("UPDATE ea_triage_jobs SET status='complete' WHERE id=2");
    await recordEmailInboxCheck("owner", "work", "failed", { dbClient: db, now });
    expect(await health()).toMatchObject({ state: "degraded" });
    await recordEmailInboxCheck("owner", "work", "success", { dbClient: db, now });
    expect((await getEmailSyncHealth("owner", { dbClient: db, now: new Date(now.getTime() + 60 * 60_000) }))[0]).toMatchObject({ state: "needs_sync" });
  });

  it("rejects stale previews before any selected job is acknowledged", async () => {
    await job(1);
    await job(2);
    const preview = await acknowledge([1, 2]);
    await db.execute("UPDATE ea_triage_jobs SET last_error='different failure' WHERE id=2");
    const before = await rows();
    await expect(acknowledge([1, 2], preview.revision)).rejects.toThrow("changed since preview");
    expect(await rows()).toEqual(before);
  });

  it("validates the entire exact owner/type/status selection and binds the reason to preview", async () => {
    await job(1);
    await job(2, "running");
    await job(3, "failed", "another-owner");
    await job(4, "failed", "owner", "email_triage");
    const before = await rows();
    for (const other of [2, 3, 4, 999]) await expect(acknowledge([1, other], "a".repeat(64))).rejects.toThrow("Every selected job");
    const preview = await acknowledge([1]);
    await expect(acknowledge([1], preview.revision, "Different disposition")).rejects.toThrow("changed since preview");
    expect(await rows()).toEqual(before);
  });

  it("rolls back all acknowledgments if any write fails", async () => {
    await job(1);
    await job(2);
    const preview = await acknowledge([1, 2]);
    const before = await rows();
    await db.execute("CREATE TRIGGER reject_ack BEFORE UPDATE ON ea_triage_jobs WHEN NEW.id=2 BEGIN SELECT RAISE(ABORT, 'write failed'); END");
    await expect(acknowledge([1, 2], preview.revision)).rejects.toThrow("write failed");
    expect(await rows()).toEqual(before);
  });
});
