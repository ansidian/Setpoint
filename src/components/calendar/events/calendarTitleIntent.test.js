import { describe, expect, it } from "vitest";
import { parseCalendarTitle } from "./parseCalendarTitle";

const BASE_CONTEXT = {
  now: new Date("2026-06-13T19:00:00.000Z").getTime(),
  baseDate: "2026-06-13",
  defaultStartTime: "09:00",
  defaultEndTime: "09:30",
};

describe("parseCalendarIntent batch de-duplication", () => {
  it("collapses a repeated explicit date so each unique date yields one batch draft", () => {
    const parsed = parseCalendarTitle(
      "Standup 2026-07-01 and 2026-07-01 and 2026-07-03",
      BASE_CONTEXT,
    );

    expect(parsed.mode).toBe("batch");
    expect(parsed.batchDrafts).toHaveLength(2);
    expect(parsed.batchDrafts.map((draft) => draft.startDate)).toEqual([
      "2026-07-01",
      "2026-07-03",
    ]);
  });

  it("collapses a repeated weekday so each unique resolved date yields one batch draft", () => {
    const parsed = parseCalendarTitle(
      "Standup next monday and next monday and next wednesday",
      BASE_CONTEXT,
    );

    expect(parsed.mode).toBe("batch");
    const dates = parsed.batchDrafts.map((draft) => draft.startDate);
    expect(new Set(dates).size).toBe(dates.length);
    expect(parsed.batchDrafts).toHaveLength(2);
  });
});
