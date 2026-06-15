import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  createSyntheticEvalRetriever,
  evaluateRetrievalCases,
  normalizeRetrievalEvalFixture,
} from "./email-search-retrieval-eval.js";

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
      results: [
        expect.objectContaining({
          id: "amazon-return",
          passed: true,
          expected_hit: true,
          must_not_top_clear: true,
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
    const migrationsDir = join(__dirname, "../../db/migrations");
    const { retrieve, cleanup } = await createSyntheticEvalRetriever(fixture, { migrationsDir });
    try {
      const report = await evaluateRetrievalCases(fixture, { retrieve });
      expect(report.total).toBe(3);
      expect(report.failed).toBe(0);
    } finally {
      await cleanup();
    }
  });
});
