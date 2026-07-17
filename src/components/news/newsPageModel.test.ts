import { describe, expect, it } from "vitest";
import {
  describeSourceHealth,
  displayExcerpt,
  planTopicSection,
  resolveDividerMarker,
  splitItemsBySeen,
  summarizeTopicSourceHealth,
} from "./newsPageModel";

const item = (id: number, publishedAt: string) => ({ id, publishedAt });

describe("splitItemsBySeen", () => {
  it("splits around the divider timestamp", () => {
    const { fresh, older } = splitItemsBySeen(
      [item(1, "2026-07-04T12:00:00Z"), item(2, "2026-07-04T08:00:00Z")],
      "2026-07-04T10:00:00Z",
    );
    expect(fresh.map((i) => i.id)).toEqual([1]);
    expect(older.map((i) => i.id)).toEqual([2]);
  });
  it("treats a null divider as nothing-fresh (first ever visit shows no divider)", () => {
    const { fresh, older } = splitItemsBySeen([item(1, "2026-07-04T12:00:00Z")], null);
    expect(fresh).toEqual([]);
    expect(older.length).toBe(1);
  });
});

describe("resolveDividerMarker", () => {
  it("adopts the payload marker on first load and holds it afterwards", () => {
    expect(resolveDividerMarker("2026-07-04T10:00:00Z", null)).toBe("2026-07-04T10:00:00Z");
    expect(resolveDividerMarker("2026-07-04T12:00:00Z", "2026-07-04T10:00:00Z"))
      .toBe("2026-07-04T10:00:00Z");
  });
  it("stays null when the server has no marker yet", () => {
    expect(resolveDividerMarker(null, null)).toBeNull();
  });
});

describe("displayExcerpt", () => {
  it("suppresses hnrss link boilerplate", () => {
    expect(displayExcerpt("Article URL: https://x.test/a Comments URL: https://news.ycombinator.com/item?id=1 Points: 108 # Comments: 54"))
      .toBe("");
  });
  it("suppresses reddit submitted-by boilerplate", () => {
    expect(displayExcerpt("submitted by /u/igetproteinfarts [link] [comments]")).toBe("");
  });
  it("passes real excerpts through and empties nullish input", () => {
    expect(displayExcerpt("A real summary of the story.")).toBe("A real summary of the story.");
    expect(displayExcerpt(null)).toBe("");
    expect(displayExcerpt(undefined)).toBe("");
  });
});

describe("planTopicSection", () => {
  const divider = "2026-07-04T10:00:00Z";
  const freshItem = item(1, "2026-07-04T12:00:00Z");
  const oldA = item(2, "2026-07-04T08:00:00Z");
  const oldB = item(3, "2026-07-04T07:00:00Z");

  it("default view: lead from fresh, older capped at 8, divider between", () => {
    const olderMany = Array.from({ length: 10 }, (_, i) => item(10 + i, "2026-07-04T0" + (i % 9) + ":00:00Z"));
    const plan = planTopicSection([freshItem, ...olderMany], divider, { hideSeen: false });
    expect(plan.lead).toBe(freshItem);
    expect(plan.freshCount).toBe(1);
    expect(plan.visibleOlder.length).toBe(8);
    expect(plan.showDivider).toBe(true);
    expect(plan.nothingNew).toBe(false);
  });

  it("default view when quiet: lead falls back to newest older, remainder capped at 5 total", () => {
    const plan = planTopicSection([oldA, oldB], divider, { hideSeen: false });
    expect(plan.lead).toBe(oldA);
    expect(plan.visibleOlder).toEqual([oldB]);
    expect(plan.quiet).toBe(true);
    expect(plan.showDivider).toBe(false);
  });

  it("hideSeen: older rows and divider suppressed, fresh untouched", () => {
    const plan = planTopicSection([freshItem, oldA], divider, { hideSeen: true });
    expect(plan.lead).toBe(freshItem);
    expect(plan.visibleOlder).toEqual([]);
    expect(plan.showDivider).toBe(false);
    expect(plan.nothingNew).toBe(false);
  });

  it("hideSeen when quiet: no stale lead fallback, nothingNew flags the stub", () => {
    const plan = planTopicSection([oldA, oldB], divider, { hideSeen: true });
    expect(plan.lead).toBeNull();
    expect(plan.visibleOlder).toEqual([]);
    expect(plan.nothingNew).toBe(true);
  });

  it("no items at all is not nothingNew (that's the 'No stories yet' state)", () => {
    const plan = planTopicSection([], divider, { hideSeen: true });
    expect(plan.hasItems).toBe(false);
    expect(plan.nothingNew).toBe(false);
  });
});

describe("describeSourceHealth", () => {
  it("flags a source after 5 consecutive failures", () => {
    expect(describeSourceHealth({ consecutiveFailures: 5, lastStatus: "403" }))
      .toEqual({ failing: true, label: "HTTP 403 · failing" });
    expect(describeSourceHealth({ consecutiveFailures: 5, lastStatus: "timeout" }))
      .toEqual({ failing: true, label: "timeout · failing" });
  });
  it("is quiet for healthy sources", () => {
    expect(describeSourceHealth({ consecutiveFailures: 0, lastStatus: "200" }))
      .toEqual({ failing: false, label: null });
  });

  it("ignores failures from disabled sources", () => {
    expect(describeSourceHealth({ enabled: false, consecutiveFailures: 9, lastStatus: "429" }))
      .toEqual({ failing: false, label: null });
  });

  it("reports an enabled Reddit 429 immediately", () => {
    expect(describeSourceHealth({
      enabled: true,
      feedUrl: "https://www.reddit.com/r/news/.rss",
      consecutiveFailures: 1,
      lastStatus: "429",
    })).toEqual({ failing: true, label: "Reddit delayed · 429" });
  });
});

describe("summarizeTopicSourceHealth", () => {
  it("describes a rate-limited Reddit feed as delayed", () => {
    expect(summarizeTopicSourceHealth([{
      enabled: true,
      feedUrl: "https://www.reddit.com/r/politics/.rss",
      consecutiveFailures: 6,
      lastStatus: "429",
    }])).toEqual({ count: 1, label: "Reddit delayed · 429", tone: "warning" });
  });

  it("uses attention copy for generic feed failures", () => {
    const failed = { enabled: true, consecutiveFailures: 5, lastStatus: "timeout" };
    expect(summarizeTopicSourceHealth([failed]))
      .toEqual({ count: 1, label: "1 feed needs attention", tone: "danger" });
    expect(summarizeTopicSourceHealth([failed, { ...failed, lastStatus: "403" }]))
      .toEqual({ count: 2, label: "2 feeds need attention", tone: "danger" });
  });

  it("keeps the full failure count when Reddit and another feed are unhealthy", () => {
    expect(summarizeTopicSourceHealth([
      {
        enabled: true,
        feedUrl: "https://www.reddit.com/r/news/.rss",
        consecutiveFailures: 1,
        lastStatus: "429",
      },
      { enabled: true, consecutiveFailures: 5, lastStatus: "timeout" },
    ])).toEqual({ count: 2, label: "2 feeds need attention", tone: "danger" });
  });
});
