import { describe, expect, it } from "vitest";
import {
  resolveActualActionStatusView,
} from "./actualActionStatusModel";

describe("resolveActualActionStatusView", () => {
  it("explains an exact fee-adjusted match", () => {
    expect(resolveActualActionStatusView({
      status: "resolved",
      actualStatus: {
        status: "already_scheduled",
        evidence: {
          amount: 101.65,
          statementAmount: 100,
          dueDate: "2026-08-12",
          adjustment: {
            policyId: "sce-card-fee",
            kind: "fixed_processing_fee",
            label: "SCE card fee",
            amount: 1.65,
          },
        },
      },
    })).toMatchObject({
      title: "Already scheduled in Actual",
      detail: "$100.00 + $1.65 fee = $101.65 due Aug 12 · No further action needed.",
    });
  });

  it("distinguishes unread email evidence from an unmatched Actual target", () => {
    const sourceGap = resolveActualActionStatusView({
      status: "resolved",
      actualStatus: { status: "needs_review", reason: "insufficient_statement_evidence" },
      plan: {
        reviewReasons: [{ code: "due_date_missing", message: "A date is required.", blocking: true }],
      } as never,
    });
    const targetGap = resolveActualActionStatusView({
      status: "resolved",
      actualStatus: { status: "needs_review", reason: "insufficient_reconciliation_identity" },
      plan: {
        reviewReasons: [{ code: "payee_target_unresolved", message: "Choose a payee.", blocking: true }],
      } as never,
    });

    expect(sourceGap).toMatchObject({
      title: "Couldn’t read email details",
      detail: "Couldn’t read a clear date from this email.",
    });
    expect(targetGap).toMatchObject({
      title: "Couldn’t match in Actual",
      detail: "Couldn’t match the payee in Actual.",
    });
  });
});
