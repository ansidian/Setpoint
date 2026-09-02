import type { Client, InStatement, TransactionMode } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailIndexTestDb } from "./test-utils/email-index-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null as unknown as Client },
}));

// test-architecture: allow-boundary-mock -- Email-index behavior executes real migrations and SQL against an ephemeral libSQL client redirected through the production singleton seam.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => testState.db.current.execute(statement),
    batch: (statements: InStatement[], mode?: TransactionMode) => testState.db.current.batch(statements, mode),
  },
}));

const { indexEmails } = await import("./email-index.ts");

beforeEach(async () => {
  testState.db.current = await createEmailIndexTestDb();
});

afterEach(() => {
  testState.db.current.close();
});

describe("email sender authentication persistence", () => {
  it("persists only the normalized projection and refreshes it without changing searchable content", async () => {
    const base = {
      uid: "gmail-work-authenticated",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      from: "Billing <notice@billing.example>",
      subject: "Statement ready",
      body_preview: "Your statement is ready.",
      body_text: "Your statement is ready.",
      date: "2026-09-01T12:00:00Z",
      read: false,
    };
    await indexEmails("user-1", [{
      ...base,
      sender_authentication: {
        version: 1,
        status: "pass",
        provider: "gmail",
        source: "gmail_authentication_results",
        headerFromDomain: "billing.example",
        dkim: [{ result: "pass", domain: "billing.example", aligned: true }],
        spf: null,
        dmarc: { result: "pass", domain: "billing.example", aligned: true },
        evaluatedAt: "2026-09-01T12:00:00.000Z",
      },
    }]);
    await indexEmails("user-1", [{
      ...base,
      sender_authentication: {
        version: 1,
        status: "fail",
        provider: "gmail",
        source: "gmail_authentication_results",
        headerFromDomain: "attacker.example",
        dkim: [],
        spf: null,
        dmarc: { result: "fail", domain: "attacker.example", aligned: false },
        evaluatedAt: "2026-09-01T12:05:00.000Z",
      },
    }]);

    const row = await testState.db.current.execute({
      sql: "SELECT sender_authentication_json FROM ea_email_index WHERE uid = ?",
      args: [base.uid],
    });
    const stored = JSON.parse(String(row.rows[0]!.sender_authentication_json));
    expect(stored).toMatchObject({
      version: 1,
      status: "fail",
      headerFromDomain: "attacker.example",
      dmarc: { result: "fail", aligned: false },
    });
    expect(JSON.stringify(stored)).not.toContain("Authentication-Results");
  });
});
