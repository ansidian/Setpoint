import { afterEach, describe, expect, it, vi } from "vitest";
import { countLabel, formatWindow, groupByDate } from "./briefingHistoryModel.js";

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
    expect(groups[0].label).toBe("Today");
    expect(groups[0].items.map((i) => i.id)).toEqual(["today-a", "today-b"]);
    expect(groups[1].label).toBe("Yesterday");
  });

  it("falls back to created_at when start_at is absent", () => {
    vi.setSystemTime(new Date("2026-05-06T19:00:00.000Z"));

    const groups = groupByDate([
      { id: "created-today", created_at: "2026-05-06T18:00:00.000Z" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
  });

  it("returns no groups for an empty list", () => {
    expect(groupByDate([])).toEqual([]);
  });
});

describe("countLabel", () => {
  it("prefers an explicit item_count over the lane-count summation", () => {
    expect(
      countLabel({
        item_count: 5,
        laneCounts: { needs_attention: 99, fyi: 99 },
      }),
    ).toBe("5 items");
  });

  it("sums lane counts when item_count is absent", () => {
    expect(
      countLabel({
        laneCounts: { needs_attention: 2, fyi: 1, noise: 0, carryover: 3 },
      }),
    ).toBe("6 items");
  });

  it("reports no visible mail when the total is zero", () => {
    expect(countLabel({ laneCounts: { needs_attention: 0, fyi: 0 } })).toBe("No visible mail");
    expect(countLabel({ item_count: 0 })).toBe("No visible mail");
    expect(countLabel({})).toBe("No visible mail");
  });

  it("uses the singular noun for exactly one item", () => {
    expect(countLabel({ item_count: 1 })).toBe("1 item");
    expect(countLabel({ laneCounts: { needs_attention: 1 } })).toBe("1 item");
  });
});

describe("formatWindow", () => {
  it("renders a start-to-end window in Pacific time", () => {
    expect(
      formatWindow({
        start_at: "2026-05-05T14:00:00.000Z",
        end_at: "2026-05-06T07:00:00.000Z",
      }),
    ).toBe("7:00 AM to 12:00 AM");
  });

  it("renders only the start label when there is no end_at", () => {
    expect(formatWindow({ start_at: "2026-05-05T14:00:00.000Z" })).toBe("7:00 AM");
  });
});
