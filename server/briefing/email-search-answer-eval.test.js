import { describe, expect, it } from "vitest";
import { evaluateAnswerCases } from "./email-search-answer-eval.js";

describe("inbox AI answer eval checks", () => {
  it("validates structure and source grounding without exact answer matching", async () => {
    const report = await evaluateAnswerCases({
      cases: [
        {
          id: "payment-answer",
          query: "what payment is due?",
          required_source_uids: ["due-notice"],
        },
      ],
    }, {
      answer: async () => ({
        answer_status: "ok",
        answer: {
          answer: "A payment is due soon.",
          confidence: "medium",
          cited_source_uids: ["due-notice"],
          missing_info: [],
          low_confidence_reason: "",
        },
        sources: [{ uid: "due-notice" }],
      }),
    });

    expect(report).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      results: [expect.objectContaining({ passed: true, problems: [] })],
    });
  });

  it("flags uncited required sources and invalid confidence", async () => {
    const report = await evaluateAnswerCases({
      cases: [
        {
          id: "security-answer",
          query: "was there a sign in alert?",
          required_source_uids: ["security-alert"],
        },
      ],
    }, {
      answer: async () => ({
        answer_status: "ok",
        answer: {
          answer: "Maybe.",
          confidence: "certain",
          cited_source_uids: [],
          missing_info: [],
          low_confidence_reason: "",
        },
        sources: [{ uid: "security-alert" }],
      }),
    });

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
    });
    expect(report.results[0].problems).toEqual([
      "invalid_confidence",
      "required_source_not_cited",
    ]);
  });
});
