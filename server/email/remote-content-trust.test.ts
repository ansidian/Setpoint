import { afterEach, describe, expect, it } from "vitest";
import { createEmailIndexTestDb } from "./test-utils/email-index-db.ts";
import {
  listRemoteContentTrust,
  normalizeRemoteContentSenderAddress,
  removeRemoteContentTrust,
  trustRemoteContentSender,
} from "./remote-content-trust.ts";

describe("remote content trust", () => {
  const openClients: Awaited<ReturnType<typeof createEmailIndexTestDb>>[] = [];

  async function fixture() {
    const dbClient = await createEmailIndexTestDb({
      extraMigrations: ["045_email_remote_content_trust.sql"],
    });
    openClients.push(dbClient);
    await dbClient.execute({
      sql: `INSERT INTO ea_accounts (id, user_id, type, email, label)
            VALUES ('gmail-work', 'user-1', 'gmail', 'me@work.example', 'Work'),
                   ('gmail-other', 'user-2', 'gmail', 'other@example.com', 'Other')`,
      args: [],
    });
    return dbClient;
  }

  afterEach(async () => {
    await Promise.all(openClients.splice(0).map((client) => client.close()));
  });

  it("normalizes exact sender addresses without accepting formatted or invalid input", () => {
    expect(normalizeRemoteContentSenderAddress("  News@Example.COM ")).toBe("news@example.com");
    expect(normalizeRemoteContentSenderAddress("News <news@example.com>")).toBeNull();
    expect(normalizeRemoteContentSenderAddress("not-an-address")).toBeNull();
  });

  it("creates, deduplicates, and lists trust scoped to the receiving account", async () => {
    const dbClient = await fixture();
    const first = await trustRemoteContentSender(
      "user-1",
      "gmail-work",
      " News@Example.COM ",
      { dbClient },
    );
    const duplicate = await trustRemoteContentSender(
      "user-1",
      "gmail-work",
      "news@example.com",
      { dbClient },
    );

    expect(duplicate.id).toBe(first.id);
    expect(await listRemoteContentTrust("user-1", { dbClient })).toEqual([
      expect.objectContaining({
        id: first.id,
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "me@work.example",
        sender_address: "news@example.com",
      }),
    ]);
    expect(await listRemoteContentTrust("user-2", { dbClient })).toEqual([]);
  });

  it("rejects trust for an account outside the owner scope", async () => {
    const dbClient = await fixture();
    await expect(trustRemoteContentSender(
      "user-1",
      "gmail-other",
      "news@example.com",
      { dbClient },
    )).rejects.toMatchObject({ status: 404 });
  });

  it("removes only the owner's selected trust entry", async () => {
    const dbClient = await fixture();
    const entry = await trustRemoteContentSender(
      "user-1",
      "gmail-work",
      "news@example.com",
      { dbClient },
    );

    await expect(removeRemoteContentTrust("user-2", entry.id, { dbClient }))
      .rejects.toMatchObject({ status: 404 });
    await removeRemoteContentTrust("user-1", entry.id, { dbClient });
    expect(await listRemoteContentTrust("user-1", { dbClient })).toEqual([]);
  });
});
