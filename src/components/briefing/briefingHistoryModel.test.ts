import { afterEach, describe, expect, it, vi } from "vitest";
import { groupByDate } from "./briefingHistoryModel";

describe("groupByDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("buckets snapshots into Today, Yesterday, and dated headers in Pacific time", () => {
    // 2026-05-06 12:00 Pacific (PDT, UTC-7). "Today" = the 6th, "Yesterday" = the 5th.
    vi.setSystemTime(new Date("2026-05-06T19:00:00.000Z"));

    const groups = groupByDate([
      { id: "today", start_at: "2026-05-06T16:00:00.000Z" },
      { id: "yesterday", start_at: "2026-05-05T16:00:00.000Z" },
      { id: "older", start_at: "2026-05-03T16:00:00.000Z" },
    ]);

    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "May 3"]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([
      ["today"],
      ["yesterday"],
      ["older"],
    ]);
  });

  it("keeps consecutive same-day snapshots in one group and preserves order", () => {
    vi.setSystemTime(new Date("2026-05-06T19:00:00.000Z"));

    const groups = groupByDate([
      { id: "today-a", start_at: "2026-05-06T17:00:00.000Z" },
      { id: "today-b", start_at: "2026-05-06T15:00:00.000Z" },
      { id: "yesterday", start_at: "2026-05-05T17:00:00.000Z" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe("Today");
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["today-a", "today-b"]);
    expect(groups[1]?.label).toBe("Yesterday");
  });

  it("falls back to created_at when start_at is absent", () => {
    vi.setSystemTime(new Date("2026-05-06T19:00:00.000Z"));

    const groups = groupByDate([
      { id: "created-today", created_at: "2026-05-06T18:00:00.000Z" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Today");
  });

  it("returns no groups for an empty list", () => {
    expect(groupByDate([])).toEqual([]);
  });
});
