// server/news/news-catalog.test.js
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NEWS_STARTER_CATALOG } from "./news-catalog.js";

describe("NEWS_STARTER_CATALOG", () => {
  it("covers the eight starter topics", () => {
    expect(NEWS_STARTER_CATALOG.map((t) => t.name)).toEqual([
      "3D Printing", "PC Gaming", "PC Hardware", "AI", "Tech", "Politics", "World", "Product Launches",
    ]);
  });
  it("every rss source has an https feedUrl; every hn source has hnQuery/minPoints shape", () => {
    for (const topic of NEWS_STARTER_CATALOG) {
      expect(topic.sources.length).toBeGreaterThan(0);
      for (const source of topic.sources) {
        expect(source.title).toBeTruthy();
        if (source.kind === "rss") {
          expect(source.feedUrl).toMatch(/^https:\/\//);
        } else {
          expect(source.kind).toBe("hn");
          expect(typeof source.hnQuery).toBe("string");
          expect(source.minPoints).toBeGreaterThan(0);
        }
      }
    }
  });
});
