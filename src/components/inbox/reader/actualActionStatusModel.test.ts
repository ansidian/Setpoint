import { describe, expect, it } from "vitest";
import {
  isActualActioned,
  resolveActualCalendarTarget,
} from "./actualActionStatusModel";

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
