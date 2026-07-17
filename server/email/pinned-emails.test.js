import { describe, expect, it } from "vitest";
import { createMigratedDb } from "../snapshots/snapshot-test-fixtures.ts";
import { loadPinnedEntries, pin, unpin } from "./pinned-emails.js";

const USER = "user-1";
const UID = "gmail-work-msg-1";

describe("pinned-emails store", () => {
  it("pin() inserts a row; loadPinnedEntries() returns it with uid + pinned_at set", async () => {
    const dbClient = await createMigratedDb();

    await pin(USER, UID, null, { dbClient });

    const entries = await loadPinnedEntries(USER, { dbClient });
    expect(entries).toHaveLength(1);
    expect(entries[0].uid).toBe(UID);
    expect(entries[0].pinned_at).toBeTruthy();
  });

  it("pin() twice (re-pin) is idempotent: one row, pinned_at unchanged, snapshot updated when provided", async () => {
    const dbClient = await createMigratedDb();

    await pin(USER, UID, { subject: "First" }, { dbClient });
    const firstLoad = await loadPinnedEntries(USER, { dbClient });
    expect(firstLoad).toHaveLength(1);
    const firstPinnedAt = firstLoad[0].pinned_at;

    // Re-pin with an updated snapshot payload.
    await pin(USER, UID, { subject: "Updated" }, { dbClient });

    const rows = await dbClient.execute({
      sql: "SELECT * FROM ea_pinned_emails WHERE user_id = ?",
      args: [USER],
    });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].pinned_at).toBe(firstPinnedAt);

    const secondLoad = await loadPinnedEntries(USER, { dbClient });
    expect(secondLoad).toHaveLength(1);
    expect(secondLoad[0].pinned_at).toBe(firstPinnedAt);
    expect(secondLoad[0].subject).toBe("Updated");
  });

  it("unpin() deletes; unpin() of a non-pinned uid is a silent no-op", async () => {
    const dbClient = await createMigratedDb();

    await pin(USER, UID, null, { dbClient });
    await unpin(USER, UID, { dbClient });

    const entries = await loadPinnedEntries(USER, { dbClient });
    expect(entries).toHaveLength(0);

    // Unpinning something never pinned must not throw.
    await expect(unpin(USER, "never-pinned-uid", { dbClient })).resolves.toBeUndefined();
  });

  it("hydrates from ea_email_index and ea_email_triage rows when present", async () => {
    const dbClient = await createMigratedDb();

    await dbClient.execute({
      sql: `INSERT INTO ea_email_index
              (uid, user_id, account_id, account_label, account_email,
               from_name, from_address, subject, body_snippet, body_text,
               email_date, read)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        UID,
        USER,
        "gmail-work",
        "Work",
        "work@example.com",
        "Casey",
        "casey@example.com",
        "Quarterly report",
        "Please find attached...",
        "Please find attached the quarterly report.",
        "2026-05-01T12:00:00Z",
        1,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, handled_at, provider_state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [USER, "gmail-work", UID, "needs_attention", "work", "high", null, "available"],
    });

    await pin(USER, UID, null, { dbClient });

    const entries = await loadPinnedEntries(USER, { dbClient });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      uid: UID,
      account_id: "gmail-work",
      subject: "Quarterly report",
      from_name: "Casey",
      from_address: "casey@example.com",
      preview: "Please find attached...",
      date: "2026-05-01T12:00:00Z",
      read: true,
      lane: "needs_attention",
      urgency: "high",
      category: "work",
      handled_at: null,
      provider_state: "available",
    });
  });

  it("falls back to email_snapshot JSON when no index/triage rows exist", async () => {
    const dbClient = await createMigratedDb();

    const snapshot = {
      subject: "Snapshot subject",
      from: "Snapshot Sender",
      from_email: "sender@example.com",
      preview: "Snapshot preview text",
      date: "2026-04-15T09:00:00Z",
      read: true,
      account_label: "Personal",
      account_email: "me@example.com",
      account_color: "#abcdef",
      account_icon: "Mail",
    };

    await pin(USER, UID, snapshot, { dbClient });

    const entries = await loadPinnedEntries(USER, { dbClient });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      uid: UID,
      subject: "Snapshot subject",
      from_name: "Snapshot Sender",
      from_address: "sender@example.com",
      preview: "Snapshot preview text",
      date: "2026-04-15T09:00:00Z",
      read: true,
      account_label: "Personal",
      account_email: "me@example.com",
      account_color: "#abcdef",
      account_icon: "Mail",
    });
  });

  it("still hydrates a trashed pin (provider_state = 'deleted') rather than filtering it out", async () => {
    const dbClient = await createMigratedDb();

    await dbClient.execute({
      sql: `INSERT INTO ea_email_index
              (uid, user_id, account_id, account_label, account_email,
               from_name, from_address, subject, body_snippet, body_text,
               email_date, read)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        UID,
        USER,
        "gmail-work",
        "Work",
        "work@example.com",
        "Casey",
        "casey@example.com",
        "Trashed subject",
        "preview",
        "preview text",
        "2026-05-01T12:00:00Z",
        1,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, provider_state)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [USER, "gmail-work", UID, "needs_attention", "work", "normal", "deleted"],
    });

    await pin(USER, UID, null, { dbClient });

    const entries = await loadPinnedEntries(USER, { dbClient });
    expect(entries).toHaveLength(1);
    expect(entries[0].provider_state).toBe("deleted");
  });

  it("orders entries newest pinned_at first", async () => {
    const dbClient = await createMigratedDb();

    await dbClient.execute({
      sql: `INSERT INTO ea_pinned_emails (user_id, email_id, pinned_at) VALUES (?, ?, ?)`,
      args: [USER, "uid-older", "2026-01-01T00:00:00Z"],
    });
    await dbClient.execute({
      sql: `INSERT INTO ea_pinned_emails (user_id, email_id, pinned_at) VALUES (?, ?, ?)`,
      args: [USER, "uid-newer", "2026-06-01T00:00:00Z"],
    });

    const entries = await loadPinnedEntries(USER, { dbClient });
    expect(entries.map((e) => e.uid)).toEqual(["uid-newer", "uid-older"]);
  });

  it("never writes ea_triage_feedback rows across pin() + unpin()", async () => {
    const dbClient = await createMigratedDb();

    await pin(USER, UID, { subject: "x" }, { dbClient });
    await pin(USER, UID, { subject: "y" }, { dbClient });
    await unpin(USER, UID, { dbClient });

    const rows = await dbClient.execute({
      sql: "SELECT * FROM ea_triage_feedback WHERE user_id = ?",
      args: [USER],
    });
    expect(rows.rows).toHaveLength(0);
  });
});
