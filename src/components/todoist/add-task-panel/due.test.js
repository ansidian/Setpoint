import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { displayTimeToInputValue, buildSeededDue, buildSeededDueDisplay } from "./due.js";

describe("displayTimeToInputValue", () => {
  it("converts am/pm display times to 24h <input type=time> values", () => {
    expect(displayTimeToInputValue("2:30 PM")).toBe("14:30");
    expect(displayTimeToInputValue("10:00 AM")).toBe("10:00");
    expect(displayTimeToInputValue("9am")).toBe("09:00");
    expect(displayTimeToInputValue("12am")).toBe("00:00");
    expect(displayTimeToInputValue("12pm")).toBe("12:00");
  });

  it("falls back to 09:00 for missing or unparseable times", () => {
    expect(displayTimeToInputValue(null)).toBe("09:00");
    expect(displayTimeToInputValue("")).toBe("09:00");
    expect(displayTimeToInputValue("whenever")).toBe("09:00");
  });
});

describe("buildSeededDue", () => {
  it("returns null for a missing or malformed date", () => {
    expect(buildSeededDue(null)).toBeNull();
    expect(buildSeededDue("")).toBeNull();
    expect(buildSeededDue("2026-04")).toBeNull();
    expect(buildSeededDue("not-a-date")).toBeNull();
  });

  it("seeds a 9am LA due from a YYYY-MM-DD date", () => {
    const due = buildSeededDue("2026-04-22");
    expect(due.dueString).toBe("2026-04-22 at 9:00 AM");
    expect(typeof due.epochMs).toBe("number");
  });
});

describe("buildSeededDueDisplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T17:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats the editing task's own due date and time", () => {
    expect(buildSeededDueDisplay({ dueDate: "2026-04-21", dueTime: "2:30 PM" }))
      .toBe("Tuesday, Apr 21 at 2:30 PM");
  });

  it("omits the time when the editing task has only a due date", () => {
    expect(buildSeededDueDisplay({ dueDate: "2026-04-21" }))
      .toBe("Tuesday, Apr 21");
  });

  it("omits the time when the due_time is unparseable (no throw)", () => {
    expect(buildSeededDueDisplay({ dueDate: "2026-04-21", dueTime: "whenever" }))
      .toBe("Tuesday, Apr 21");
  });

  it("returns null for a malformed editing due date", () => {
    expect(buildSeededDueDisplay({ dueDate: "2026-04" })).toBeNull();
  });

  it("falls back to the create-mode seeded display when there is no editing due date", () => {
    expect(buildSeededDueDisplay({ dueDate: null, seededCreateDue: { display: "April 22, 2026" } }))
      .toBe("April 22, 2026");
    expect(buildSeededDueDisplay({ dueDate: null, seededCreateDue: null })).toBeNull();
  });
});
