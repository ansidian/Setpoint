import { describe, expect, it } from "vitest";
import { rankEmailSearchRows } from "./email-search-ranking.js";

describe("rankEmailSearchRows", () => {
  it("lets an older useful subject/sender match beat a newer body-only low-value match", () => {
    const rows = [
      {
        uid: "newer-noise-body",
        from_name: "Retail Updates",
        from_address: "promo@example.com",
        subject: "Weekend digest",
        body_snippet: "Tuition receipt mentioned near the bottom.",
        email_date: "2026-05-06T12:00:00Z",
        read: 1,
        rank: -1,
        triage_lane: "noise",
        triage_category: "promotions",
      },
      {
        uid: "older-finance-subject",
        from_name: "Bursar Office",
        from_address: "billing@school.edu",
        subject: "Tuition receipt ready",
        body_snippet: "Payment confirmation attached.",
        email_date: "2026-04-20T12:00:00Z",
        read: 1,
        rank: -5,
        triage_lane: "needs_attention",
        triage_category: "finance",
        triage_urgency: "high",
        triage_deadline_at: "2026-05-10T16:00:00Z",
      },
    ];

    const ranked = rankEmailSearchRows(rows, {
      query: "tuition receipt",
      limit: 2,
      now: "2026-05-08T12:00:00Z",
    });

    expect(ranked.map((row) => row.uid)).toEqual([
      "older-finance-subject",
      "newer-noise-body",
    ]);
  });
});
