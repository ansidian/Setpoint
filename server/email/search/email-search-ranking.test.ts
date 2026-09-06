import { describe, expect, it } from "vitest";
import { rankEmailSearchRows } from "./email-search-ranking.ts";

const NOW = "2026-05-01T12:00:00Z";

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

describe("recurring-family newest-first dominance", () => {
  // Same sender + same subject = a recurring family (monthly statements, autopay
  // notices). Stale metadata on an older sibling must not outrank the newest copy.
  const family = {
    from_name: "Bank",
    from_address: "billing@bank.com",
    subject: "Your statement is ready",
    read: 1,
  };

  it("ranks the newest family member first even when an older sibling carries more triage points", () => {
    const rows = [
      {
        ...family,
        uid: "statement-old",
        body_snippet: "Statement balance attached.",
        email_date: "2026-03-25T12:00:00Z",
        triage_category: "finance",
        triage_bill_candidate_json: "{\"amount\":42}",
      },
      {
        ...family,
        uid: "statement-new",
        body_snippet: "Statement balance attached.",
        email_date: "2026-04-28T12:00:00Z",
      },
    ];

    const ranked = rankEmailSearchRows(rows, { query: "statement", limit: 2, now: NOW });

    expect(ranked.map((row) => row.uid)).toEqual(["statement-new", "statement-old"]);
  });

  it("keeps a fully-resolved family newest-first at any evaluation time (score-floor tiebreak)", () => {
    // Both siblings handled with past deadlines: every attention signal is
    // resolved, so far in the future recency decays to the same floor for both
    // and only the family clamp + date tiebreak keeps the newest first. The
    // inbox eval path silently depends on this at real Date.now().
    const rows = [
      {
        ...family,
        uid: "resolved-old",
        body_snippet: "Statement balance attached.",
        email_date: "2026-03-25T12:00:00Z",
        triage_lane: "needs_attention",
        triage_deadline_at: "2026-04-01T00:00:00Z",
        triage_handled_at: "2026-04-02T00:00:00Z",
        triage_bill_candidate_json: "{\"amount\":42}",
      },
      {
        ...family,
        uid: "resolved-new",
        body_snippet: "Statement balance attached.",
        email_date: "2026-04-28T12:00:00Z",
        triage_lane: "needs_attention",
        triage_deadline_at: "2026-05-07T00:00:00Z",
        triage_handled_at: "2026-05-08T00:00:00Z",
      },
    ];

    const ranked = rankEmailSearchRows(rows, {
      query: "statement",
      limit: 2,
      now: "2035-01-01T00:00:00Z",
    });

    expect(ranked.map((row) => row.uid)).toEqual(["resolved-new", "resolved-old"]);
  });

  it("does not rescue a deliberately penalized newest member (noise stays demoted)", () => {
    const rows = [
      {
        ...family,
        uid: "statement-old-clean",
        body_snippet: "Statement balance attached.",
        email_date: "2026-03-25T12:00:00Z",
      },
      {
        ...family,
        uid: "statement-new-noise",
        body_snippet: "Statement balance attached.",
        email_date: "2026-04-28T12:00:00Z",
        triage_lane: "noise",
      },
    ];

    const ranked = rankEmailSearchRows(rows, { query: "statement", limit: 2, now: NOW });

    expect(ranked.map((row) => row.uid)).toEqual(["statement-old-clean", "statement-new-noise"]);
  });

  it("skips the clamp when the newest member is penalized even if query points push its total positive", () => {
    // Query "bank.com" showers sender points (+45 exact, +42 domain, +15 token) on both
    // rows, so the noise-lane newest still totals positive — the guard must key on the
    // penalty itself, not the total, or the clamp drags the clean older copy down to a
    // tie and the date tiebreak puts the noise copy first.
    const rows = [
      {
        ...family,
        uid: "old-clean",
        body_snippet: "Statement balance attached.",
        email_date: "2026-03-25T12:00:00Z",
        triage_lane: "fyi",
      },
      {
        ...family,
        uid: "new-noise-positive",
        body_snippet: "Statement balance attached.",
        email_date: "2026-04-28T12:00:00Z",
        triage_lane: "noise",
      },
    ];

    const ranked = rankEmailSearchRows(rows, { query: "bank.com", limit: 2, now: NOW });

    expect(ranked.map((row) => row.uid)).toEqual(["old-clean", "new-noise-positive"]);
  });

  it("never groups subjectless emails into a family", () => {
    // Distinct no-subject emails from one sender are not a recurring series; grouping
    // them would let the clamp wrongly demote an older, better-matching one.
    const rows = [
      {
        ...family,
        uid: "no-subject-old",
        subject: "",
        body_snippet: "Statement balance attached.",
        email_date: "2026-03-25T12:00:00Z",
        triage_category: "finance",
        triage_bill_candidate_json: "{\"amount\":42}",
      },
      {
        ...family,
        uid: "no-subject-new",
        subject: "",
        body_snippet: "Unrelated note.",
        email_date: "2026-04-28T12:00:00Z",
      },
    ];

    const ranked = rankEmailSearchRows(rows, { query: "statement", limit: 2, now: NOW });

    expect(ranked.map((row) => row.uid)).toEqual(["no-subject-old", "no-subject-new"]);
  });

  it("leaves same-sender emails with different subjects unclamped (not a family)", () => {
    const rows = [
      {
        ...family,
        uid: "different-old",
        subject: "Rate change notice for your account",
        body_snippet: "Statement note.",
        email_date: "2026-03-25T12:00:00Z",
        triage_category: "finance",
        triage_bill_candidate_json: "{\"amount\":42}",
      },
      {
        ...family,
        uid: "different-new",
        subject: "Weekly digest",
        body_snippet: "Statement note.",
        email_date: "2026-04-28T12:00:00Z",
      },
    ];

    const ranked = rankEmailSearchRows(rows, { query: "statement", limit: 2, now: NOW });

    expect(ranked.map((row) => row.uid)).toEqual(["different-old", "different-new"]);
  });
});

describe("thread-recency newest-first dominance", () => {
  // Same non-null thread_id but DIFFERENT subjects (reply threads whose subjects
  // diverge with "Re:" prefixes) must still clamp older siblings to the newest
  // member's score, same as the from+subject family clamp. This is an ADDITIONAL
  // dominance pass, not a replacement for the family key.
  const base = {
    from_name: "Contractor",
    from_address: "ops@contractor.example",
    read: 1,
  };

  it("ranks the newest thread member first even when an older sibling carries more triage points and a different subject", () => {
    const rows = [
      {
        ...base,
        uid: "thread-old",
        subject: "Water heater quote",
        thread_id: "t-1",
        body_snippet: "Quote attached.",
        email_date: "2026-03-25T12:00:00Z",
        triage_category: "finance",
        triage_bill_candidate_json: "{\"amount\":42}",
      },
      {
        ...base,
        uid: "thread-new",
        subject: "Re: Water heater quote",
        thread_id: "t-1",
        body_snippet: "Quote attached.",
        email_date: "2026-04-28T12:00:00Z",
      },
    ];

    const ranked = rankEmailSearchRows(rows, { query: "water heater", limit: 2, now: NOW });

    expect(ranked.map((row) => row.uid)).toEqual(["thread-new", "thread-old"]);
  });

  it("never groups null thread_id rows even with matching subjects", () => {
    const rows = [
      {
        ...base,
        uid: "null-thread-old",
        subject: "Different subject one",
        thread_id: null,
        body_snippet: "Note.",
        email_date: "2026-03-25T12:00:00Z",
        triage_category: "finance",
        triage_bill_candidate_json: "{\"amount\":42}",
      },
      {
        ...base,
        uid: "null-thread-new",
        subject: "Different subject two",
        thread_id: null,
        body_snippet: "Note.",
        email_date: "2026-04-28T12:00:00Z",
      },
    ];

    const ranked = rankEmailSearchRows(rows, { query: "note", limit: 2, now: NOW });

    expect(ranked.map((row) => row.uid)).toEqual(["null-thread-old", "null-thread-new"]);
  });

  it("skips the thread clamp when the newest member is penalized (noise stays demoted)", () => {
    const rows = [
      {
        ...base,
        uid: "thread-old-clean",
        subject: "Water heater quote",
        thread_id: "t-2",
        body_snippet: "Quote attached.",
        email_date: "2026-03-25T12:00:00Z",
      },
      {
        ...base,
        uid: "thread-new-noise",
        subject: "Re: Water heater quote",
        thread_id: "t-2",
        body_snippet: "Quote attached.",
        email_date: "2026-04-28T12:00:00Z",
        triage_lane: "noise",
      },
    ];

    const ranked = rankEmailSearchRows(rows, { query: "water heater", limit: 2, now: NOW });

    expect(ranked.map((row) => row.uid)).toEqual(["thread-old-clean", "thread-new-noise"]);
  });
});
