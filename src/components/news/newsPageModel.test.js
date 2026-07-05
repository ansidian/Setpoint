import { describe, expect, it } from "vitest";
import { describeSourceHealth, displayExcerpt, resolveDividerMarker, splitItemsBySeen } from "./newsPageModel.js";

const item = (id, publishedAt) => ({ id, publishedAt });

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
});
