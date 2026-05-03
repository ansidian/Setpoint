import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  buildTriageEvalReport,
  parseLabeledTriageExamples,
  runTriageEval,
} from "./triage-eval.js";

describe("triage eval fixtures", () => {
  it("parses manually labeled examples from the local seed shape", () => {
    const examples = parseLabeledTriageExamples({
      generated_at: "2026-05-03T04:49:11.207Z",
      eval_seed: [
        {
          sample_id: "weak-unlabeled",
          subject: "Weak legacy row",
          expected_lane: null,
        },
        {
          sample_id: "manual-action",
          account_label: "Personal",
          sender_display: "School Billing",
          subject: "Tuition payment due",
          summary: "Balance is due Friday.",
          expected_lane: "needs_attention",
          expected_category: "finance",
          expected_urgency: "high",
          expected_escalation_badge: "High Risk",
          expected_deadline_at: "2026-05-08T16:00:00.000Z",
          labels_verified: true,
          mock_model_outputs: {
            strong: {
              lane: "fyi",
              category: "finance",
              urgency: "normal",
              escalation_badge: null,
              deadline_at: null,
            },
          },
        },
      ],
    });

    expect(examples).toEqual([
      expect.objectContaining({
        id: "manual-action",
        email: expect.objectContaining({
          account_label: "Personal",
          from_name: "School Billing",
          subject: "Tuition payment due",
          body_snippet: "Balance is due Friday.",
        }),
        expected: {
          lane: "needs_attention",
          category: "finance",
          urgency: "high",
          escalation_badge: "High Risk",
          deadline_at: "2026-05-08T16:00:00.000Z",
        },
        mock_model_outputs: {
          strong: expect.objectContaining({ lane: "fyi" }),
        },
      }),
    ]);
  });
});

describe("triage eval metrics", () => {
  it("reports dangerous misses before aggregate score summaries", () => {
    const report = buildTriageEvalReport([
      {
        id: "missed-action",
        expected: {
          lane: "needs_attention",
          category: "finance",
          urgency: "high",
          escalation_badge: "High Risk",
          deadline_at: "2026-05-08T16:00:00.000Z",
        },
        actual: {
          lane: "fyi",
          category: "finance",
          urgency: "normal",
          escalation_badge: null,
          deadline_at: "2026-05-09T16:00:00.000Z",
        },
        modelCalls: ["cheap"],
      },
      {
        id: "benign-category",
        expected: {
          lane: "fyi",
          category: "delivery",
          urgency: "low",
          escalation_badge: null,
          deadline_at: null,
        },
        actual: {
          lane: "fyi",
          category: "updates",
          urgency: "low",
          escalation_badge: null,
          deadline_at: null,
        },
        modelCalls: [],
      },
    ]);

    expect(report.dangerous_misses).toEqual([
      expect.objectContaining({
        id: "missed-action",
        problems: [
          "false_negative_needs_attention",
          "false_negative_escalation",
          "incorrect_urgency",
          "deadline_mismatch",
        ],
      }),
    ]);
    expect(Object.keys(report)).toEqual([
      "dangerous_misses",
      "stats",
      "mismatches",
      "schema_failures",
    ]);
    expect(report.stats).toMatchObject({
      total: 2,
      false_negative_needs_attention: 1,
      false_negative_escalation: 1,
      hallucinated_deadlines: 0,
      incorrect_urgency: 1,
      json_schema_stability_failures: 0,
      exact_lane_matches: 1,
      exact_category_matches: 1,
    });
  });
});

describe("triage eval runner", () => {
  it("runs labeled fixtures with deterministic mocked model output by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "triage-eval-"));
    const fixturePath = join(dir, "labeled.json");
    await writeFile(fixturePath, JSON.stringify({
      eval_seed: [
        {
          sample_id: "payment-miss",
          sender_display: "School Billing",
          subject: "Payment due for tuition",
          summary: "Tuition balance is due May 8.",
          expected_lane: "needs_attention",
          expected_category: "finance",
          expected_urgency: "high",
          expected_escalation_badge: "High Risk",
          labels_verified: true,
          mock_model_outputs: {
            strong: {
              lane: "fyi",
              category: "finance",
              urgency: "normal",
              escalation_badge: null,
              summary: "Tuition statement is available.",
              action: "Review when convenient",
              deadline_at: null,
              confidence: 0.8,
              bill_candidate: null,
            },
          },
        },
      ],
    }));

    const report = await runTriageEval({ fixturePath });

    expect(report).toMatchObject({
      fixturePath,
      labeled_examples: 1,
      stats: {
        total: 1,
        false_negative_needs_attention: 1,
        false_negative_escalation: 1,
        hallucinated_deadlines: 0,
        incorrect_urgency: 1,
        json_schema_stability_failures: 0,
        exact_lane_matches: 0,
        exact_category_matches: 1,
      },
      dangerous_misses: [
        expect.objectContaining({
          id: "payment-miss",
          modelCalls: ["strong"],
        }),
      ],
    });
  });
});
