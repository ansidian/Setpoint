import { describe, expect, it } from "vitest";
import {
  computeRemindAt,
  computeReminderState,
} from "./reminder-model.ts";

describe("reminder model", () => {
  it("converts reminder offsets to absolute trigger times", () => {
    expect(computeRemindAt("2026-05-10T17:00:00.000Z", -30))
      .toBe("2026-05-10T16:30:00.000Z");
  });

  it("classifies due rows inside and outside the missed-reminder grace window", () => {
    expect(computeReminderState({
      remindAt: "2026-05-10T10:30:00.000Z",
      now: "2026-05-10T16:00:00.000Z",
    })).toBe("due");
    expect(computeReminderState({
      remindAt: "2026-05-10T09:59:59.999Z",
      now: "2026-05-10T16:00:00.000Z",
    })).toBe("missed");
  });
});
