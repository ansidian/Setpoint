import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { getActiveSnapshotView } from "./snapshot-service.js";
import { wakeDueSnoozes } from "./snooze-waker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../db/migrations");

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  for (const file of [
    "016_email_search_index.sql",
    "023_snoozed_emails.sql",
    "024_snoozed_resurfaced.sql",
    "030_triage_snapshots.sql",
    "036_snapshot_item_source_metadata.sql",
  ]) {
    await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return db;
}

describe("snooze waker", () => {
  it("reattaches woken snoozes to the active snapshot with resurfaced source metadata", async () => {
    const dbClient = await createMigratedDb();
    const now = new Date("2026-05-04T17:30:00.000Z");
    const resurfacedAt = now.getTime();
    const wakeAtGmailFn = vi.fn().mockResolvedValue(undefined);

    await dbClient.execute({
      sql: `INSERT INTO ea_snoozed_emails
              (user_id, email_id, until_ts, email_snapshot, status)
            VALUES (?, ?, ?, ?, 'snoozed')`,
      args: ["user-1", "gmail-work-msg-1", resurfacedAt - 1_000, JSON.stringify({
        uid: "gmail-work-msg-1",
        id: "gmail-work-msg-1",
        account_id: "gmail-work",
        account_label: "Work Gmail",
        account_email: "work@example.test",
        account_color: "#cba6da",
        account_icon: "Mail",
        subject: "Wake this thread",
        from_name: "Casey",
        from_address: "casey@example.test",
        date: "2026-05-02T15:00:00.000Z",
        summary: "Follow up on the woken thread",
        action: "Reply",
        category: "school",
        urgency: "high",
        lane: "needs_attention",
        read: false,
      })],
    });

    const result = await wakeDueSnoozes({
      userId: "user-1",
      dbClient,
      now,
      loadUserConfigFn: vi.fn(async () => ({
        accounts: [{ id: "gmail-work", email: "work@example.test", type: "gmail" }],
      })),
      wakeAtGmailFn,
    });

    expect(result).toEqual({ woke: 1 });
    expect(wakeAtGmailFn).toHaveBeenCalledWith(
      { id: "gmail-work", email: "work@example.test", type: "gmail" },
      "gmail-work-msg-1",
    );

    const snoozeRows = await dbClient.execute({
      sql: "SELECT status, resurfaced_at FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
      args: ["user-1", "gmail-work-msg-1"],
    });
    expect(snoozeRows.rows).toEqual([{ status: "resurfaced", resurfaced_at: resurfacedAt }]);

    const view = await getActiveSnapshotView("user-1", { dbClient, now });
    expect(view.lanes.needs_attention).toHaveLength(1);
    expect(view.lanes.needs_attention[0]).toMatchObject({
      uid: "gmail-work-msg-1",
      subject: "Wake this thread",
      source: "resurfaced_snooze",
      source_at: "2026-05-04T17:30:00.000Z",
      resurfaced_at: resurfacedAt,
      _resurfaced: true,
      _resurfacedAt: resurfacedAt,
    });
  });
});
