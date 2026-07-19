import { describe, expect, it } from "vitest";
import { scoreEmailSearchRow } from "./email-search-ranking.ts";
import type { EmailSearchRankingRow, EmailSearchScoring } from "./email-search-ranking.ts";

const NOW = "2026-05-01T12:00:00Z";

// A minimal row that scores exactly 0: no query terms match, lane defaults to
// "untriaged", no dates (so no recency / interaction / deadline signals fire).
// Each test perturbs ONE field off this baseline and asserts the resulting
// score delta in isolation.
function baselineRow(overrides: Partial<EmailSearchRankingRow> = {}): EmailSearchRankingRow & { uid: string } {
  return {
    from_name: "Nobody",
    from_address: "nobody@example.com",
    subject: "untitled",
    body_snippet: "no relevant content here",
    read: 1,
    ...overrides,
    uid: String(overrides.uid || "baseline"),
  };
}

function scoreOf(overrides: Partial<EmailSearchRankingRow>, opts: Parameters<typeof scoreEmailSearchRow>[1] = {}): EmailSearchScoring {
  return scoreEmailSearchRow(baselineRow(overrides), { now: NOW, query: "", ...opts });
}

// Returns the value the scorer attributed to a single detail label, or 0 if absent.
function deltaFor(scoring: EmailSearchScoring, label: string): number {
  const detail = scoring.details.find((d) => d.label === label);
  return detail ? detail.value : 0;
}

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
    const deadlineIn = (days: number) => new Date(NOW_MS + days * DAY_MS).toISOString();

    function deadlineScoring(days: number) {
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
    const sentDaysAgo = (days: number) => new Date(NOW_MS - days * DAY_MS).toISOString();

    function recencyValue(days: number) {
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
    const interactedDaysAgo = (days: number) => new Date(NOW_MS - days * DAY_MS).toISOString();

    function interactionScoring(days: number) {
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

});
