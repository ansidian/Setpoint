import type { Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchEmails } from "./email-index-search.ts";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
  seedIndexedEmail,
} from "./test-utils/email-index-db.ts";

describe("indexed email search", () => {
  let db: Client;

  beforeEach(async () => {
    db = await createEmailIndexTestDb();
    await seedEmailAccount(db, {
      id: "gmail-work",
      email: "work+owner@example.com",
    });
  });

  afterEach(async () => {
    await db.close?.();
  });

  it("keeps lexical search, read filtering, highlights, debug scoring, and Gmail links together", async () => {
    await seedIndexedEmail(db, {
      uid: "gmail-gmail-work-read",
      account_email: "work+owner@example.com",
      subject: "Tuition receipt",
      body_snippet: "Paid in full",
      body_text: "Paid in full",
      email_date: "2026-05-01T12:00:00Z",
      read: 1,
    });
    await seedIndexedEmail(db, {
      uid: "gmail-gmail-work-unread",
      account_email: "work+owner@example.com",
      subject: "Tuition invoice",
      body_snippet: "Payment is due",
      body_text: "Payment is due",
      email_date: "2026-05-02T12:00:00Z",
      read: 0,
    });

    const response = await searchEmails("user-1", {
      q: "tuition is:unread",
      debug: true,
      dbClient: db,
    });

    expect(response).toMatchObject({
      total: 1,
      offset: 0,
      has_more: false,
      capped: false,
      query: "tuition is:unread",
    });
    expect(response.results).toEqual([
      expect.objectContaining({
        uid: "gmail-gmail-work-unread",
        subject_highlight: "<mark>Tuition</mark> invoice",
        read: false,
        web_url: "https://mail.google.com/mail/?authuser=work%2Bowner%40example.com#all/unread",
        account_id: "gmail-work",
        search_score: expect.any(Number),
        search_score_details: expect.objectContaining({ score: expect.any(Number) }),
      }),
    ]);
    expect(response.accounts).toEqual([
      expect.objectContaining({
        account_id: "gmail-work",
        results: response.results,
      }),
    ]);
  });

  it("paginates the ranked set while reporting the full bounded total", async () => {
    await seedIndexedEmail(db, {
      uid: "gmail-gmail-work-new",
      subject: "Status update",
      email_date: "2026-05-03T12:00:00Z",
      read: 1,
    });
    await seedIndexedEmail(db, {
      uid: "gmail-gmail-work-old",
      subject: "Status update",
      email_date: "2026-05-02T12:00:00Z",
      read: 1,
    });
    await seedIndexedEmail(db, {
      uid: "gmail-gmail-work-unread",
      subject: "Status update",
      email_date: "2026-05-04T12:00:00Z",
      read: 0,
    });

    const response = await searchEmails("user-1", {
      q: "is:read",
      limit: "1",
      offset: "1",
      dbClient: db,
    });

    expect(response).toMatchObject({
      total: 2,
      offset: 1,
      has_more: false,
      capped: false,
      query: "is:read",
    });
    expect(response.results.map((email) => email.uid)).toEqual(["gmail-gmail-work-old"]);
    expect(response.results[0]).not.toHaveProperty("search_score");
  });

  it("projects valid triage bill metadata into the existing search result shape", async () => {
    await seedIndexedEmail(db, {
      uid: "gmail-gmail-work-bill",
      subject: "Utility bill",
    });
    const billCandidate = {
      payee_hint: "City Utilities",
      amount_due: 84.25,
      dueDate: "2026-05-10",
    };
    await db.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, bill_candidate_json)
            VALUES (?, ?, ?, 'complete', ?)`,
      args: ["user-1", "gmail-work", "gmail-gmail-work-bill", JSON.stringify(billCandidate)],
    });

    const response = await searchEmails("user-1", {
      q: "utility",
      dbClient: db,
    });

    expect(response.results[0]).toMatchObject({
      hasBill: true,
      bill_candidate: billCandidate,
      extractedBill: {
        payee: "City Utilities",
        amount: 84.25,
        due_date: "2026-05-10",
        type: "expense",
      },
    });
  });
});
