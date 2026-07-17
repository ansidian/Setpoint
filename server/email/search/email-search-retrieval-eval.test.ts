import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  createSyntheticEvalRetriever,
  evaluateRetrievalCases,
  normalizeRetrievalEvalFixture,
} from "./email-search-retrieval-eval.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("email search retrieval eval runner", () => {
  it("checks expected top-N hits and must-not-top decoys", async () => {
    const fixture = normalizeRetrievalEvalFixture({
      cases: [
        {
          id: "amazon-return",
          query: "amazon return deadline",
          expected_uids: ["expected-return"],
          top_n: 2,
          must_not_top: ["refund-decoy"],
        },
      ],
    });
    const retrieve = vi.fn(async () => ({
      candidates: [
        { uid: "expected-return" },
        { uid: "refund-decoy" },
      ],
    }));

    const report = await evaluateRetrievalCases(fixture, { retrieve });

    expect(report).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      mrr: 1,
      results: [
        expect.objectContaining({
          id: "amazon-return",
          passed: true,
          expected_hit: true,
          must_not_top_clear: true,
          expected_rank: 1,
        }),
      ],
    });
  });

  it("flags missing expected UIDs and top-ranked decoys", async () => {
    const report = await evaluateRetrievalCases({
      cases: [
        {
          id: "payment-due",
          query: "payment due",
          expected_uids: ["due-notice"],
          top_n: 1,
          must_not_top: ["receipt-decoy"],
        },
      ],
    }, {
      retrieve: async () => ({
        candidates: [
          { uid: "receipt-decoy" },
          { uid: "due-notice" },
        ],
      }),
    });

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
    });
    expect(report.results[0]).toMatchObject({
      expected_hit: false,
      must_not_top_clear: false,
      problems: ["expected_uid_not_in_top_n", "must_not_top_ranked_too_high"],
    });
  });

  it("runs the synthetic corpus fixture green at full embedding coverage", async () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, "evals/email-search-retrieval.synthetic.json"), "utf8"),
    );
    const { retrieve, retrieveInbox, cleanup } = await createSyntheticEvalRetriever(fixture);
    try {
      const report = await evaluateRetrievalCases(fixture, { retrieve, retrieveInbox });
      expect(report.total).toBe(6);
      expect(report.failed).toBe(0);
      const flaggedResults = report.results.filter((result) => "inbox_passed" in result);
      expect(flaggedResults.every((result) => result.inbox_passed)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("reports per-case expected_rank and an aggregate MRR", async () => {
    const fixture = normalizeRetrievalEvalFixture({
      cases: [
        { id: "rank-2", query: "a", expected_uids: ["a"], top_n: 3 },
        { id: "rank-1", query: "b", expected_uids: ["b"], top_n: 3 },
        { id: "miss", query: "zz", expected_uids: ["zz"], top_n: 3 },
      ],
    });
    const retrieve = async () => ({
      candidates: [{ uid: "b" }, { uid: "a" }, { uid: "c" }],
    });

    const report = await evaluateRetrievalCases(fixture, { retrieve });

    expect(report.results.map((result) => result.expected_rank)).toEqual([2, 1, null]);
    expect(report.mrr).toBeCloseTo((0.5 + 1 + 0) / 3);
  });

  it("excludes cases without expected_uids from the MRR denominator", async () => {
    // A must-not-top-only case has no expected rank to average; letting it
    // dilute the mean would silently deflate MRR as guard cases are added.
    const fixture = normalizeRetrievalEvalFixture({
      cases: [
        { id: "rank-1", query: "b", expected_uids: ["b"], top_n: 3 },
        { id: "rank-2", query: "a", expected_uids: ["a"], top_n: 3 },
        { id: "guard-only", query: "c", must_not_top: ["c"], top_n: 3 },
      ],
    });
    const retrieve = async () => ({
      candidates: [{ uid: "b" }, { uid: "a" }],
    });

    const report = await evaluateRetrievalCases(fixture, { retrieve });

    expect(report.mrr).toBeCloseTo((1 + 0.5) / 2);
  });

  describe("dual-path evaluation (audit F3)", () => {
    // Two independent retrieve fns returning different orders, so a bug that
    // reused the retrieval-path ranking for the inbox path would surface as a
    // wrong inbox_expected_rank instead of accidentally passing.
    const retrieve = async () => ({
      candidates: [{ uid: "b" }, { uid: "a" }],
    });
    const retrieveInbox = async () => ({
      candidates: [{ uid: "a" }, { uid: "b" }],
    });

    it("reports both expected_rank and inbox_expected_rank for a flagged case", async () => {
      const fixture = normalizeRetrievalEvalFixture({
        cases: [
          { id: "flagged", query: "a", expected_uids: ["a"], top_n: 2, inbox_path: true },
        ],
      });

      const report = await evaluateRetrievalCases(fixture, { retrieve, retrieveInbox });

      expect(report.results[0]).toMatchObject({
        id: "flagged",
        expected_rank: 2,
        inbox_expected_rank: 1,
        inbox_passed: true,
      });
    });

    it("reports no inbox fields for a case without the inbox_path flag", async () => {
      const fixture = normalizeRetrievalEvalFixture({
        cases: [
          { id: "unflagged", query: "a", expected_uids: ["a"], top_n: 2 },
        ],
      });

      const report = await evaluateRetrievalCases(fixture, { retrieve, retrieveInbox });

      expect(report.results[0]).not.toHaveProperty("inbox_expected_rank");
      expect(report.results[0]).not.toHaveProperty("inbox_passed");
      expect(report.results[0]).not.toHaveProperty("inbox_hit");
      expect(report.results[0]).not.toHaveProperty("inbox_must_not_top_clear");
    });

    it("aggregates inbox_mrr only over flagged cases with expected_uids", async () => {
      const fixture = normalizeRetrievalEvalFixture({
        cases: [
          { id: "flagged-rank-1", query: "a", expected_uids: ["a"], top_n: 2, inbox_path: true },
          { id: "flagged-rank-2", query: "b", expected_uids: ["b"], top_n: 2, inbox_path: true },
          { id: "unflagged", query: "c", expected_uids: ["c"], top_n: 2 },
        ],
      });
      const dualRetrieve = async (_userId: string, { q }: { q: string; limit: number }) => ({
        candidates: q === "b" ? [{ uid: "z" }, { uid: "b" }] : [{ uid: "a" }, { uid: "z" }],
      });
      const dualRetrieveInbox = async (_userId: string, { q }: { q: string; limit: number }) => ({
        // "a" ranks 1st (inbox_expected_rank=1); "b" ranks 2nd (inbox_expected_rank=2);
        // "c" is unflagged so its inbox ranking must not affect inbox_mrr.
        candidates: q === "b" ? [{ uid: "z" }, { uid: "b" }] : q === "c" ? [{ uid: "z" }, { uid: "c" }] : [{ uid: "a" }, { uid: "z" }],
      });

      const report = await evaluateRetrievalCases(fixture, {
        retrieve: dualRetrieve,
        retrieveInbox: dualRetrieveInbox,
      });

      expect(report.inbox_mrr).toBeCloseTo((1 / 1 + 1 / 2) / 2);
    });

    it("does not run the inbox path or emit inbox_mrr when no case is flagged", async () => {
      const fixture = normalizeRetrievalEvalFixture({
        cases: [
          { id: "unflagged", query: "a", expected_uids: ["a"], top_n: 2 },
        ],
      });
      const retrieveInboxSpy = vi.fn(retrieveInbox);

      const report = await evaluateRetrievalCases(fixture, { retrieve, retrieveInbox: retrieveInboxSpy });

      expect(retrieveInboxSpy).not.toHaveBeenCalled();
      expect(report.inbox_mrr).toBeUndefined();
    });
  });
});
