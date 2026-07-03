import { describe, expect, it } from "vitest";
import { rankEmailSearchRows, scoreEmailSearchRow } from "./email-search-ranking.js";

const NOW = "2026-05-01T12:00:00Z";

// A minimal row that scores exactly 0: no query terms match, lane defaults to
// "untriaged", no dates (so no recency / interaction / deadline signals fire).
// Each test perturbs ONE field off this baseline and asserts the resulting
// score delta in isolation.
function baselineRow(overrides = {}) {
  return {
    uid: "baseline",
    from_name: "Nobody",
    from_address: "nobody@example.com",
    subject: "untitled",
    body_snippet: "no relevant content here",
    read: 1,
    ...overrides,
  };
}

function scoreOf(overrides, opts = {}) {
  return scoreEmailSearchRow(baselineRow(overrides), { now: NOW, query: "", ...opts });
}

// Returns the value the scorer attributed to a single detail label, or 0 if absent.
function deltaFor(scoring, label) {
  const detail = scoring.details.find((d) => d.label === label);
  return detail ? detail.value : 0;
}

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

describe("scoreEmailSearchRow per-signal contributions", () => {
  it("scores the baseline row at exactly 0 with no signals", () => {
    const scoring = scoreOf({});
    expect(scoring.score).toBe(0);
    expect(scoring.details).toEqual([]);
  });

  describe("sender match: exact vs domain vs name", () => {
    it("awards exact_sender +45 when the query equals the full address", () => {
      const scoring = scoreEmailSearchRow(
        baselineRow({ from_address: "alerts@bank.com" }),
        { now: NOW, query: "alerts@bank.com" },
      );
      expect(deltaFor(scoring, "exact_sender")).toBe(45);
      // The address also literally contains the term, so the per-term
      // sender_token still fires alongside the exact-sender bonus.
      expect(deltaFor(scoring, "sender_token")).toBe(15);
      expect(deltaFor(scoring, "sender_domain")).toBe(0);
    });

    it("awards sender_domain +42 (and exact via @domain) when the query is a bare domain", () => {
      const scoring = scoreEmailSearchRow(
        baselineRow({ from_address: "alerts@bank.com" }),
        { now: NOW, query: "bank.com" },
      );
      expect(deltaFor(scoring, "sender_domain")).toBe(42);
      // A bare-domain query also satisfies the `@phrase` branch of exact_sender.
      expect(deltaFor(scoring, "exact_sender")).toBe(45);
    });

    it("awards sender_name +18 when only the display name matches the phrase", () => {
      const scoring = scoreEmailSearchRow(
        baselineRow({ from_name: "Acme Bank", from_address: "no@elsewhere.test" }),
        { now: NOW, query: "acme bank" },
      );
      expect(deltaFor(scoring, "sender_name")).toBe(18);
      expect(deltaFor(scoring, "exact_sender")).toBe(0);
      expect(deltaFor(scoring, "sender_domain")).toBe(0);
    });
  });

  describe("subject match: phrase vs single token", () => {
    it("adds subject_phrase +34 on top of per-token hits when the whole phrase appears", () => {
      const scoring = scoreEmailSearchRow(
        baselineRow({ subject: "your tuition receipt is ready" }),
        { now: NOW, query: "tuition receipt" },
      );
      expect(deltaFor(scoring, "subject_phrase")).toBe(34);
      // Both query terms appear individually too: subject_token (+9) fires per term.
      const tokenHits = scoring.details.filter((d) => d.label === "subject_token");
      expect(tokenHits).toHaveLength(2);
    });

    it("awards only subject_token +9 (no phrase bonus) when the phrase is not contiguous", () => {
      const scoring = scoreEmailSearchRow(
        baselineRow({ subject: "your tuition info packet" }),
        { now: NOW, query: "tuition receipt" },
      );
      expect(deltaFor(scoring, "subject_phrase")).toBe(0);
      expect(deltaFor(scoring, "subject_token")).toBe(9);
    });
  });

  describe("lane", () => {
    it("awards lane_needs_attention +28 for both needs_attention and action lanes", () => {
      expect(deltaFor(scoreOf({ triage_lane: "needs_attention" }), "lane_needs_attention")).toBe(28);
      expect(deltaFor(scoreOf({ triage_lane: "action" }), "lane_needs_attention")).toBe(28);
    });

    it("awards lane_fyi +8 for the fyi lane", () => {
      expect(deltaFor(scoreOf({ triage_lane: "fyi" }), "lane_fyi")).toBe(8);
    });

    it("applies the lane_noise -65 penalty for the noise lane", () => {
      const scoring = scoreOf({ triage_lane: "noise" });
      expect(deltaFor(scoring, "lane_noise")).toBe(-65);
      expect(scoring.score).toBe(-65);
    });
  });

  describe("provider removal and dismissal penalties", () => {
    it("applies provider_removed -100 when the snapshot is provider-removed", () => {
      const scoring = scoreOf({ snapshot_provider_removed_at: "2026-04-30T00:00:00Z" });
      expect(deltaFor(scoring, "provider_removed")).toBe(-100);
      expect(scoring.score).toBe(-100);
    });

    it("applies provider_state_removed -100 for removed/deleted/archived/trashed states", () => {
      for (const state of ["removed", "deleted", "archived", "trashed"]) {
        const scoring = scoreOf({ triage_provider_state: state });
        expect(deltaFor(scoring, "provider_state_removed")).toBe(-100);
      }
      // An active provider state earns no penalty.
      expect(deltaFor(scoreOf({ triage_provider_state: "active" }), "provider_state_removed")).toBe(0);
    });

    it("applies dismissed_today -28 when dismissed from today's view", () => {
      const scoring = scoreOf({ snapshot_dismissed_from_today_at: "2026-04-30T00:00:00Z" });
      expect(deltaFor(scoring, "dismissed_today")).toBe(-28);
      expect(scoring.score).toBe(-28);
    });
  });

  describe("urgency tiers", () => {
    it("scores high +18, medium +9, low -2", () => {
      expect(deltaFor(scoreOf({ triage_urgency: "high" }), "urgency_high")).toBe(18);
      expect(deltaFor(scoreOf({ triage_urgency: "medium" }), "urgency_medium")).toBe(9);
      expect(deltaFor(scoreOf({ triage_urgency: "low" }), "urgency_low")).toBe(-2);
    });

    it("adds no urgency signal for normal urgency", () => {
      const scoring = scoreOf({ triage_urgency: "normal" });
      expect(scoring.details.some((d) => d.label.startsWith("urgency_"))).toBe(false);
    });
  });

  describe("deadline tiers at day boundaries", () => {
    const NOW_MS = Date.parse(NOW);
    const DAY_MS = 24 * 60 * 60 * 1000;
    const deadlineIn = (days) => new Date(NOW_MS + days * DAY_MS).toISOString();

    function deadlineScoring(days) {
      return scoreEmailSearchRow(
        baselineRow({ triage_deadline_at: deadlineIn(days) }),
        { now: NOW, query: "" },
      );
    }

    it("treats day 0 as deadline_soon +18", () => {
      const s = deadlineScoring(0);
      expect(deltaFor(s, "deadline_soon")).toBe(18);
      expect(deltaFor(s, "deadline_future")).toBe(0);
      expect(deltaFor(s, "deadline_signal")).toBe(0);
    });

    it("treats day 3 (inclusive upper bound) as deadline_soon +18", () => {
      expect(deltaFor(deadlineScoring(3), "deadline_soon")).toBe(18);
    });

    it("treats day 3.01 (just past soon) as deadline_future +10", () => {
      const s = deadlineScoring(3.01);
      expect(deltaFor(s, "deadline_soon")).toBe(0);
      expect(deltaFor(s, "deadline_future")).toBe(10);
    });

    it("treats day 14 (inclusive upper bound) as deadline_future +10", () => {
      expect(deltaFor(deadlineScoring(14), "deadline_future")).toBe(10);
    });

    it("treats day 14.01 (just past future) as deadline_signal +5", () => {
      const s = deadlineScoring(14.01);
      expect(deltaFor(s, "deadline_future")).toBe(0);
      expect(deltaFor(s, "deadline_signal")).toBe(5);
    });

    it("expires a past deadline entirely (no deadline points once it has passed)", () => {
      const s = deadlineScoring(-1);
      expect(deltaFor(s, "deadline_soon")).toBe(0);
      expect(deltaFor(s, "deadline_future")).toBe(0);
      expect(deltaFor(s, "deadline_signal")).toBe(0);
    });
  });

  describe("resolved emails (handled or past-deadline) lose stale attention signals", () => {
    const NOW_MS = Date.parse(NOW);
    const DAY_MS = 24 * 60 * 60 * 1000;
    const handled = { triage_handled_at: "2026-04-30T00:00:00Z" };

    it("demotes a handled needs_attention lane to the resolved fyi-level bonus", () => {
      const s = scoreOf({ triage_lane: "needs_attention", ...handled });
      expect(deltaFor(s, "lane_needs_attention")).toBe(0);
      expect(deltaFor(s, "lane_needs_attention_resolved")).toBe(8);
    });

    it("suppresses positive urgency, escalation badge, and the old handled bonus once handled", () => {
      const s = scoreOf({
        triage_lane: "needs_attention",
        triage_urgency: "high",
        triage_escalation_badge: "bill due",
        ...handled,
      });
      expect(deltaFor(s, "urgency_high")).toBe(0);
      expect(deltaFor(s, "escalation_badge")).toBe(0);
      expect(s.details.some((d) => d.label === "handled_important")).toBe(false);
    });

    it("suppresses future-deadline bonuses once handled (bill already paid)", () => {
      const s = scoreOf({
        triage_deadline_at: new Date(NOW_MS + 2 * DAY_MS).toISOString(),
        ...handled,
      });
      expect(deltaFor(s, "deadline_soon")).toBe(0);
      expect(deltaFor(s, "deadline_future")).toBe(0);
      expect(deltaFor(s, "deadline_signal")).toBe(0);
    });

    it("keeps urgency_low demotion and bill/category traits for handled rows", () => {
      const s = scoreOf({
        triage_urgency: "low",
        triage_category: "finance",
        triage_bill_candidate_json: "{\"amount\":1}",
        ...handled,
      });
      expect(deltaFor(s, "urgency_low")).toBe(-2);
      expect(deltaFor(s, "useful_category")).toBe(8);
      expect(deltaFor(s, "bill_candidate")).toBe(16);
    });

    it("expires attention signals when the deadline has passed even if unhandled", () => {
      const s = scoreOf({
        triage_lane: "needs_attention",
        triage_urgency: "high",
        triage_escalation_badge: "bill due",
        triage_deadline_at: new Date(NOW_MS - DAY_MS).toISOString(),
      });
      expect(deltaFor(s, "lane_needs_attention")).toBe(0);
      expect(deltaFor(s, "lane_needs_attention_resolved")).toBe(8);
      expect(deltaFor(s, "urgency_high")).toBe(0);
      expect(deltaFor(s, "escalation_badge")).toBe(0);
    });
  });

  describe("recency decay", () => {
    const NOW_MS = Date.parse(NOW);
    const DAY_MS = 24 * 60 * 60 * 1000;
    const sentDaysAgo = (days) => new Date(NOW_MS - days * DAY_MS).toISOString();

    function recencyValue(days) {
      const scoring = scoreEmailSearchRow(
        baselineRow({ email_date: sentDaysAgo(days) }),
        { now: NOW, query: "" },
      );
      return deltaFor(scoring, "recency");
    }

    it("awards the full +20 for an email sent now (age 0)", () => {
      expect(recencyValue(0)).toBe(20);
    });

    it("decays linearly to +13 at 20 days (20 - 20*0.35)", () => {
      expect(recencyValue(20)).toBeCloseTo(13, 10);
    });

    it("floors recency at 0 once age passes ~57 days", () => {
      // ageDays * 0.35 reaches 20 at ~57.14d; just past that clamps to 0.
      expect(recencyValue(58)).toBe(0);
      // and stays at 0 for much older mail
      expect(recencyValue(365)).toBe(0);
    });
  });

  describe("recent_interaction decay window", () => {
    const NOW_MS = Date.parse(NOW);
    const DAY_MS = 24 * 60 * 60 * 1000;
    const interactedDaysAgo = (days) => new Date(NOW_MS - days * DAY_MS).toISOString();

    function interactionScoring(days) {
      return scoreEmailSearchRow(
        baselineRow({ triage_updated_at: interactedDaysAgo(days) }),
        { now: NOW, query: "" },
      );
    }

    it("awards +4 for an interaction right now (age 0)", () => {
      expect(deltaFor(interactionScoring(0), "recent_interaction")).toBe(4);
    });

    it("awards +0.5 at the 7-day inclusive edge (4 - 7*0.5)", () => {
      expect(deltaFor(interactionScoring(7), "recent_interaction")).toBeCloseTo(0.5, 10);
    });

    it("drops the recent_interaction signal entirely past 7 days", () => {
      const scoring = interactionScoring(7.01);
      expect(scoring.details.some((d) => d.label === "recent_interaction")).toBe(false);
    });
  });

  describe("bill_candidate JSON gate", () => {
    it("awards bill_candidate +16 only for a non-empty JSON payload", () => {
      expect(deltaFor(scoreOf({ triage_bill_candidate_json: "{\"amount\":42}" }), "bill_candidate")).toBe(16);
    });

    it("does not fire for empty-object, null, or missing payloads", () => {
      expect(deltaFor(scoreOf({ triage_bill_candidate_json: "{}" }), "bill_candidate")).toBe(0);
      expect(deltaFor(scoreOf({ triage_bill_candidate_json: "null" }), "bill_candidate")).toBe(0);
      expect(deltaFor(scoreOf({ triage_bill_candidate_json: "" }), "bill_candidate")).toBe(0);
      expect(deltaFor(scoreOf({}), "bill_candidate")).toBe(0);
    });
  });

  describe("useful_category membership", () => {
    it("awards useful_category +8 for a category in the useful set", () => {
      for (const category of ["finance", "bills", "school", "security", "work", "travel", "health", "legal"]) {
        expect(deltaFor(scoreOf({ triage_category: category }), "useful_category")).toBe(8);
      }
    });

    it("does not award useful_category for categories outside the set", () => {
      expect(deltaFor(scoreOf({ triage_category: "promotions" }), "useful_category")).toBe(0);
      expect(deltaFor(scoreOf({ triage_category: "social" }), "useful_category")).toBe(0);
    });
  });

  describe("body_all_terms bonus", () => {
    it("awards body_all_terms +12 when every multi-term query word appears in the body", () => {
      const scoring = scoreEmailSearchRow(
        baselineRow({
          subject: "weekly note",
          from_name: "Sender",
          from_address: "sender@nowhere.test",
          body_snippet: "the alpha figures and the beta figures are attached",
        }),
        { now: NOW, query: "alpha beta" },
      );
      expect(deltaFor(scoring, "body_all_terms")).toBe(12);
    });

    it("does not award body_all_terms when only some terms appear in the body", () => {
      const scoring = scoreEmailSearchRow(
        baselineRow({
          subject: "weekly note",
          from_name: "Sender",
          from_address: "sender@nowhere.test",
          body_snippet: "the alpha figures are attached",
        }),
        { now: NOW, query: "alpha beta" },
      );
      expect(deltaFor(scoring, "body_all_terms")).toBe(0);
    });

    it("does not award body_all_terms for a single-term query (requires >1 term)", () => {
      const scoring = scoreEmailSearchRow(
        baselineRow({
          subject: "weekly note",
          from_name: "Sender",
          from_address: "sender@nowhere.test",
          body_snippet: "the alpha figures are attached",
        }),
        { now: NOW, query: "alpha" },
      );
      expect(deltaFor(scoring, "body_token")).toBe(2);
      expect(deltaFor(scoring, "body_all_terms")).toBe(0);
    });
  });

  it("exposes per-signal details through rankEmailSearchRows debug mode", () => {
    const [ranked] = rankEmailSearchRows(
      [baselineRow({ uid: "row-1", triage_lane: "needs_attention", triage_urgency: "high" })],
      { query: "", now: NOW, debug: true },
    );
    expect(ranked.search_score).toBe(46); // 28 (lane) + 18 (urgency high)
    expect(ranked.search_score_details.score).toBe(46);
    expect(deltaFor(ranked.search_score_details, "lane_needs_attention")).toBe(28);
    expect(deltaFor(ranked.search_score_details, "urgency_high")).toBe(18);
  });
});
