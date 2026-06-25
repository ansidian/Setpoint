import { describe, it, expect } from "vitest";
import {
  resolveDeadlineRescheduleTarget,
  buildDeadlineReschedulePayload,
  deadlineDragAllowed,
} from "./calendarDeadlineRescheduleModel.js";

describe("resolveDeadlineRescheduleTarget", () => {
  it("returns the target date when it differs from the source", () => {
    expect(resolveDeadlineRescheduleTarget("2026-06-22", "2026-06-25")).toBe("2026-06-25");
  });
  it("returns null for a same-day drop (no-op)", () => {
    expect(resolveDeadlineRescheduleTarget("2026-06-22", "2026-06-22")).toBeNull();
  });
  it("returns null when either date is missing", () => {
    expect(resolveDeadlineRescheduleTarget(null, "2026-06-25")).toBeNull();
    expect(resolveDeadlineRescheduleTarget("2026-06-22", null)).toBeNull();
  });
});

describe("buildDeadlineReschedulePayload", () => {
  it("re-supplies the existing time so the move keeps it (day-only shift)", () => {
    expect(buildDeadlineReschedulePayload({ due_time: "3:00 PM" }, "2026-07-01"))
      .toEqual({ dueDate: "2026-07-01", dueTime: "3:00 PM" });
  });
  it("omits dueTime for an all-day task (no time to preserve)", () => {
    expect(buildDeadlineReschedulePayload({ due_time: null }, "2026-07-01"))
      .toEqual({ dueDate: "2026-07-01" });
  });
});

describe("deadlineDragAllowed", () => {
  const base = { itemKind: "deadline", recurring: false, complete: false };
  it("allows a non-recurring, incomplete deadline when drag is enabled", () => {
    expect(deadlineDragAllowed(base, true)).toBe(true);
  });
  it("blocks when drag is disabled, recurring, complete, or not a deadline", () => {
    expect(deadlineDragAllowed(base, false)).toBe(false);
    expect(deadlineDragAllowed({ ...base, recurring: true }, true)).toBe(false);
    expect(deadlineDragAllowed({ ...base, complete: true }, true)).toBe(false);
    expect(deadlineDragAllowed({ ...base, itemKind: "event" }, true)).toBe(false);
  });
});
