import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

describe("Bill Pay mappings v2 migration", () => {
  const clients: ReturnType<typeof createClient>[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  it("preserves ordered identity and targets while removing retired behavior policy", async () => {
    const db = createClient({ url: "file::memory:" });
    clients.push(db);
    await db.executeMultiple(`
      CREATE TABLE ea_settings (user_id TEXT PRIMARY KEY, bill_pay_mappings_json TEXT);
      INSERT INTO ea_settings VALUES ('valid', '${JSON.stringify({
        version: 1,
        profiles: [
          {
            id: "électricité",
            name: "Électricité ⚡",
            enabled: true,
            identity: { domain: ["billing.example"] },
            behaviors: [
              {
                id: "bill",
                name: "Monthly bill",
                enabled: true,
                type: "bill",
                intent: { subject: ["statement"] },
                amountStrategy: "statement_balance",
                amountFallback: "use_model_amount",
                targets: { payee_id: "p1", payee_label: "Électricité", category_id: "c1" },
              },
              {
                id: "refund",
                name: "Refund",
                enabled: false,
                type: "income",
                targets: { account_id: "a1" },
              },
            ],
          },
          {
            id: "second",
            name: "Second",
            enabled: false,
            identity: { sender: ["billing@second.example"] },
            behaviors: [],
          },
        ],
      }).replaceAll("'", "''")}');
      INSERT INTO ea_settings VALUES ('malformed', '{not-json');
    `);
    await db.executeMultiple(readFileSync(join(migrationsDir, "051_bill_pay_mappings_v2.sql"), "utf8"));

    const rows = await db.execute("SELECT user_id, bill_pay_mappings_json FROM ea_settings ORDER BY user_id");
    const malformed = JSON.parse(String(rows.rows[0]!.bill_pay_mappings_json));
    const valid = JSON.parse(String(rows.rows[1]!.bill_pay_mappings_json));

    expect(malformed).toEqual({ version: 2, profiles: [] });
    expect(valid).toEqual({
      version: 2,
      profiles: [
        {
          id: "électricité",
          name: "Électricité ⚡",
          enabled: true,
          identity: { domain: ["billing.example"] },
          behaviors: [
            {
              id: "bill",
              name: "Monthly bill",
              enabled: true,
              type: "bill",
              targets: { payee_id: "p1", payee_label: "Électricité", category_id: "c1" },
            },
            {
              id: "refund",
              name: "Refund",
              enabled: false,
              type: "income",
              targets: { account_id: "a1" },
            },
          ],
        },
        { id: "second", name: "Second", enabled: false, identity: { sender: ["billing@second.example"] }, behaviors: [] },
      ],
    });
    expect(JSON.stringify(valid)).not.toMatch(/intent|amountStrategy|amountFallback/);
  });
});
