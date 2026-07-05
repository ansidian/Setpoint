// server/news/news-model.test.js
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildHnFeedUrl, buildNewsPagePayload, canonicalizeNewsUrl,
  dedupeByCanonicalUrl, excerptFromHtml, NEWS_ITEMS_PER_TOPIC,
  resolveSourceFeedUrl, shouldPollSource,
} from "./news-model.js";

describe("canonicalizeNewsUrl", () => {
  it("strips tracking params, hash, www, and trailing slash", () => {
    expect(canonicalizeNewsUrl("https://www.theverge.com/a/b/?utm_source=rss&utm_medium=feed#comments"))
      .toBe("https://theverge.com/a/b");
  });
  it("keeps meaningful query params", () => {
    expect(canonicalizeNewsUrl("https://example.com/watch?v=abc123&utm_campaign=x"))
      .toBe("https://example.com/watch?v=abc123");
  });
  it("returns trimmed input for unparseable URLs", () => {
    expect(canonicalizeNewsUrl(" not a url ")).toBe("not a url");
  });
});

describe("buildHnFeedUrl", () => {
  it("builds a keyword feed with points", () => {
    expect(buildHnFeedUrl({ query: "3d printing", minPoints: 30 }))
      .toBe("https://hnrss.org/newest?q=3d%20printing&points=30");
  });
  it("falls back to the front page when query is blank", () => {
    expect(buildHnFeedUrl({ query: "  ", minPoints: 100 }))
      .toBe("https://hnrss.org/frontpage?points=100");
  });
  it("defaults minPoints to 50", () => {
    expect(buildHnFeedUrl({ query: "AI" })).toBe("https://hnrss.org/newest?q=AI&points=50");
  });
});

describe("resolveSourceFeedUrl", () => {
  it("returns feed_url for rss sources", () => {
    expect(resolveSourceFeedUrl({ kind: "rss", feed_url: "https://x/feed" })).toBe("https://x/feed");
  });
  it("builds from hn_query + min_points for hn sources", () => {
    expect(resolveSourceFeedUrl({ kind: "hn", feed_url: "stale", hn_query: "AI", min_points: 60 }))
      .toBe("https://hnrss.org/newest?q=AI&points=60");
  });
});

describe("shouldPollSource", () => {
  const NOW = new Date("2026-07-04T12:00:00.000Z");
  it("polls a healthy enabled source", () => {
    expect(shouldPollSource({ enabled: 1, consecutive_failures: 0 }, NOW)).toBe(true);
  });
  it("skips disabled sources", () => {
    expect(shouldPollSource({ enabled: 0, consecutive_failures: 0 }, NOW)).toBe(false);
  });
  it("polls at 4 failures but backs off at 5 within 6h", () => {
    const base = { enabled: 1, last_fetch_at: "2026-07-04T11:00:00.000Z" };
    expect(shouldPollSource({ ...base, consecutive_failures: 4 }, NOW)).toBe(true);
    expect(shouldPollSource({ ...base, consecutive_failures: 5 }, NOW)).toBe(false);
  });
  it("retries a backed-off source after 6h", () => {
    expect(shouldPollSource(
      { enabled: 1, consecutive_failures: 9, last_fetch_at: "2026-07-04T05:59:00.000Z" }, NOW,
    )).toBe(true);
  });
});

describe("excerptFromHtml", () => {
  it("strips tags and entities, collapses whitespace", () => {
    expect(excerptFromHtml("<p>Hello <b>world</b> &amp; friends</p>\n\n  more"))
      .toBe("Hello world & friends more");
  });
  it("truncates at a word boundary with ellipsis", () => {
    const out = excerptFromHtml("word ".repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });
  it("returns empty string for nullish input", () => {
    expect(excerptFromHtml(null)).toBe("");
  });
});

describe("dedupeByCanonicalUrl", () => {
  it("keeps the first (newest) of syndicated duplicates", () => {
    const items = [
      { id: 1, canonical_url: "https://a/x" },
      { id: 2, canonical_url: "https://b/y" },
      { id: 3, canonical_url: "https://a/x" },
    ];
    expect(dedupeByCanonicalUrl(items).map((i) => i.id)).toEqual([1, 2]);
  });
});

describe("buildNewsPagePayload", () => {
  const topics = [
    { id: 2, user_id: "u1", name: "AI", position: 1 },
    { id: 1, user_id: "u1", name: "PC Hardware", position: 0 },
  ];
  const sources = [
    { id: 10, topic_id: 1, kind: "rss", title: "Tom's", feed_url: "https://t/f", site_url: "https://t",
      enabled: 1, hn_query: null, min_points: null, etag: null, last_modified: null,
      last_fetch_at: "2026-07-04T11:50:00.000Z", last_status: "200", consecutive_failures: 0 },
    { id: 11, topic_id: 2, kind: "hn", title: "HN AI", feed_url: "https://hnrss.org/newest?q=AI&points=50",
      site_url: null, enabled: 1, hn_query: "AI", min_points: 50, etag: null, last_modified: null,
      last_fetch_at: "2026-07-04T11:55:00.000Z", last_status: "200", consecutive_failures: 0 },
  ];
  const items = [
    { id: 100, source_id: 10, guid: "a", url: "https://t/a?utm_source=rss", canonical_url: "https://t/a",
      title: "GPU news", excerpt: "e", author: null, published_at: "2026-07-04T10:00:00.000Z",
      fetched_at: "2026-07-04T10:05:00.000Z", thumbnail_url: null },
    { id: 101, source_id: 11, guid: "b", url: "https://x/b", canonical_url: "https://x/b",
      title: "AI story", excerpt: "e", author: null, published_at: "2026-07-04T11:00:00.000Z",
      fetched_at: "2026-07-04T11:05:00.000Z", thumbnail_url: null },
  ];

  it("orders topics by position and shapes camelCase", () => {
    const payload = buildNewsPagePayload({ topics, sources, items, lastSeenAt: "2026-07-04T09:00:00.000Z" });
    expect(payload.topics.map((t) => t.name)).toEqual(["PC Hardware", "AI"]);
    expect(payload.topics[0].items[0]).toMatchObject({
      id: 100, sourceId: 10, sourceTitle: "Tom's", url: "https://t/a?utm_source=rss",
      publishedAt: "2026-07-04T10:00:00.000Z",
    });
    expect(payload.topics[1].sources[0]).toMatchObject({ kind: "hn", hnQuery: "AI", minPoints: 50 });
    expect(payload.lastSeenAt).toBe("2026-07-04T09:00:00.000Z");
  });

  it("computes lastUpdatedAt as the max source last_fetch_at", () => {
    const payload = buildNewsPagePayload({ topics, sources, items, lastSeenAt: null });
    expect(payload.lastUpdatedAt).toBe("2026-07-04T11:55:00.000Z");
  });

  it("sorts items newest-first, dedupes within a topic, caps at NEWS_ITEMS_PER_TOPIC", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: 200 + i, source_id: 10, guid: `g${i}`, url: `https://t/${i}`, canonical_url: `https://t/${i % 35}`,
      title: `t${i}`, excerpt: "", author: null,
      published_at: `2026-07-03T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
      fetched_at: "2026-07-03T00:00:00.000Z", thumbnail_url: null,
    }));
    const payload = buildNewsPagePayload({ topics, sources, items: many, lastSeenAt: null });
    const hw = payload.topics[0].items;
    expect(hw.length).toBeLessThanOrEqual(NEWS_ITEMS_PER_TOPIC);
    const stamps = hw.map((i) => i.publishedAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
    const canon = new Set(hw.map((i) => i.url));
    expect(canon.size).toBe(hw.length);
  });
});
