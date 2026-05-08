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

  it("uses indexed body text so prefix FTS matches can compete with generic semantic hits", () => {
    const rows = [
      {
        uid: "generic-prime",
        from_name: "Streaming Updates",
        from_address: "no-reply@example.com",
        subject: "$6 Prime credit inside",
        body_snippet: "Prime Video credit expires soon.",
        body_highlight: "Play Minecraft Legends included with [Prime] [Promotional] credits",
        email_date: "2025-10-24T23:03:14Z",
        read: 1,
      },
      {
        uid: "prime-visa-credit",
        from_name: "Chase Visa Card",
        from_address: "ChaseVisaCard@message.card.visa.com",
        subject: "Activate to get a $15 statement credit",
        body_snippet: "Spend $100 with your credit card.",
        body_highlight: "Chase_RBP 2026 [Prime] Visa Spend 100",
        body_text: "Prime Visa promotional offer. Spend 100 and get a statement credit.",
        email_date: "2026-04-06T21:01:20Z",
        read: 1,
      },
    ];

    const ranked = rankEmailSearchRows(rows, {
      query: "prime promo",
      limit: 2,
      now: "2026-04-10T12:00:00Z",
    });

    expect(ranked.map((row) => row.uid)).toEqual([
      "prime-visa-credit",
      "generic-prime",
    ]);
  });
});
