import { describe, expect, it } from "vitest";
import {
  isActualActioned,
  resolveActualActionStatusView,
  resolveActualCalendarTarget,
} from "./actualActionStatusModel";

describe("resolveActualActionStatusView", () => {
  it("shows a quiet verification state while Actual is being checked", () => {
    expect(resolveActualActionStatusView({ status: "loading" })).toEqual({
      tone: "checking",
      title: "Checking Actual…",
      detail: "Looking for a matching schedule or transaction.",
    });
  });

  it("explains when the statement is already scheduled", () => {
    expect(resolveActualActionStatusView({
      status: "resolved",
      actualStatus: {
        status: "already_scheduled",
        evidence: {
          name: "Acme Utilities",
          amount: 142.31,
          dueDate: "2026-08-12",
        },
      },
    })).toEqual({
      tone: "success",
      title: "Already scheduled in Actual",
      detail: "$142.31 due Aug 12 · No further action needed.",
    });
  });

  it("explains when a due statement is already recorded", () => {
    expect(resolveActualActionStatusView({
      status: "resolved",
      actualStatus: {
        status: "already_recorded",
        evidence: { amount: 88.2, dueDate: "2026-07-16" },
      },
    })).toMatchObject({
      tone: "success",
      title: "Already recorded in Actual",
      detail: "$88.20 on Jul 16 · No further action needed.",
    });
  });

  it("turns conflicting evidence into a review state", () => {
    expect(resolveActualActionStatusView({
      status: "resolved",
      actualStatus: { status: "needs_review", reason: "amount_mismatch" },
    })).toEqual({
      tone: "warning",
      title: "Actual match needs review",
      detail: "The amount in Actual differs from this statement.",
    });
  });

  it("distinguishes a fresh statement from an unavailable check", () => {
    expect(resolveActualActionStatusView({
      status: "resolved",
      actualStatus: { status: "not_scheduled", reason: "no_match" },
    })).toMatchObject({
      tone: "neutral",
      title: "Not scheduled in Actual",
    });
    expect(resolveActualActionStatusView({ status: "error" })).toMatchObject({
      tone: "unavailable",
      title: "Couldn’t verify Actual",
    });
  });

  it("returns no presentation before a check starts", () => {
    expect(resolveActualActionStatusView({ status: "idle" })).toBeNull();
  });
});

describe("isActualActioned", () => {
  it("only treats exact schedules and transactions as actioned", () => {
    expect(isActualActioned({ status: "already_scheduled" })).toBe(true);
    expect(isActualActioned({ status: "already_recorded" })).toBe(true);
    expect(isActualActioned({ status: "needs_review" })).toBe(false);
    expect(isActualActioned({ status: "not_scheduled" })).toBe(false);
  });
});

describe("resolveActualCalendarTarget", () => {
  it("targets the matched schedule on its due date", () => {
    expect(resolveActualCalendarTarget({
      status: "already_scheduled",
      evidence: {
        kind: "schedule",
        scheduleId: "schedule-acme",
        dueDate: "2026-08-12",
      },
    })).toEqual({
      date: "2026-08-12",
      itemId: "schedule-acme",
    });
  });

  it("targets the matched transaction on its recorded date", () => {
    expect(resolveActualCalendarTarget({
      status: "already_recorded",
      evidence: {
        kind: "transaction",
        transactionId: "transaction-42",
        dueDate: "2026-07-16",
      },
    })).toEqual({
      date: "2026-07-16",
      itemId: "transaction-42",
    });
  });
});
