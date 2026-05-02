import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWeekDays, derivePassedState } from "./scheduleModel.js";

describe("derivePassedState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T16:00:00-07:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks timed events passed when their end or start is before now", () => {
    const nowMs = Date.now();

    expect(derivePassedState([
      { id: "ended", startMs: nowMs - 3_600_000, endMs: nowMs - 60_000 },
      { id: "no-end", startMs: nowMs - 60_000 },
      { id: "current", startMs: nowMs - 60_000, endMs: nowMs + 60_000 },
      { id: "all-day", allDay: true, startMs: nowMs - 60_000, endMs: nowMs - 1 },
    ])).toEqual([
      { id: "ended", startMs: nowMs - 3_600_000, endMs: nowMs - 60_000, passed: true },
      { id: "no-end", startMs: nowMs - 60_000, passed: true },
      { id: "current", startMs: nowMs - 60_000, endMs: nowMs + 60_000, passed: false },
      { id: "all-day", allDay: true, startMs: nowMs - 60_000, endMs: nowMs - 1, passed: false },
    ]);
  });

  it("keeps empty inputs unchanged", () => {
    expect(derivePassedState(undefined)).toBeUndefined();
    expect(derivePassedState([])).toEqual([]);
  });
});

describe("buildWeekDays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T09:00:00-07:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the next Sunday through Saturday grouped by event day labels", () => {
    const sundayEvent = { id: "sun", dayLabel: "Sun, May 3" };
    const thursdayEvent = { id: "thu", dayLabel: "Thu, May 7" };

    expect(buildWeekDays([thursdayEvent, sundayEvent])).toEqual([
      { label: "Sun, May 3", events: [sundayEvent] },
      { label: "Mon, May 4", events: [] },
      { label: "Tue, May 5", events: [] },
      { label: "Wed, May 6", events: [] },
      { label: "Thu, May 7", events: [thursdayEvent] },
      { label: "Fri, May 8", events: [] },
      { label: "Sat, May 9", events: [] },
    ]);
  });
});
