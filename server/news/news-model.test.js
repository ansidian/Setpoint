// server/news/news-model.test.js
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildHnFeedUrl, buildNewsPagePayload, canonicalizeNewsUrl,
  dedupeByCanonicalUrl, excerptFromHtml, isTitleMuted, NEWS_ITEMS_PER_TOPIC,
  parseMutedTerms, resolveSourceFeedUrl, sanitizeMutedTerms, shouldPollSource,
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

describe("mute terms", () => {
  it("parseMutedTerms tolerates junk and non-arrays", () => {
    expect(parseMutedTerms(null)).toEqual([]);
    expect(parseMutedTerms("not json")).toEqual([]);
    expect(parseMutedTerms('{"a":1}')).toEqual([]);
    expect(parseMutedTerms('["crypto", "", 3, "AI"]')).toEqual(["crypto", "AI"]);
  });

  it("sanitizeMutedTerms trims, drops empties, dedupes case-insensitively", () => {
    expect(sanitizeMutedTerms([" crypto ", "Crypto", "", "AI"])).toEqual(["crypto", "AI"]);
  });

  it("sanitizeMutedTerms rejects non-arrays, non-strings, oversized terms and lists", () => {
    expect(sanitizeMutedTerms("crypto")).toBeNull();
    expect(sanitizeMutedTerms([42])).toBeNull();
    expect(sanitizeMutedTerms(["x".repeat(81)])).toBeNull();
    expect(sanitizeMutedTerms(Array.from({ length: 51 }, (_, i) => `t${i}`))).toBeNull();
  });

  it("isTitleMuted matches whole words case-insensitively, title-only semantics", () => {
    expect(isTitleMuted("OpenAI ships AI agent", ["ai"])).toBe(true);
    expect(isTitleMuted("Spain said email works", ["ai"])).toBe(false); // no substring hits
    expect(isTitleMuted("Elon Musk does a thing", ["elon musk"])).toBe(true); // phrase
    expect(isTitleMuted("Learning C++ the hard way", ["c++"])).toBe(true); // regex-escaped
    expect(isTitleMuted("ASP.NET rides again", [".net"])).toBe(false); // preceded by a word char
    expect(isTitleMuted("Anything", [])).toBe(false);
    expect(isTitleMuted(null, ["x"])).toBe(false);
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

  it("keeps a cross-topic duplicate only in the first topic by position", () => {
    const dupA = {
      id: 300, source_id: 10, guid: "d1", url: "https://s.test/story",
      canonical_url: "https://s.test/story", title: "Big story", excerpt: "", author: null,
      published_at: "2026-07-04T11:30:00.000Z", fetched_at: "2026-07-04T11:31:00.000Z", thumbnail_url: null,
    };
    const dupB = {
      id: 301, source_id: 11, guid: "d2", url: "https://s.test/story?utm_source=hn",
      canonical_url: "https://s.test/story", title: "Big story", excerpt: "", author: null,
      published_at: "2026-07-04T11:32:00.000Z", fetched_at: "2026-07-04T11:33:00.000Z", thumbnail_url: null,
    };
    const payload = buildNewsPagePayload({ topics, sources, items: [...items, dupA, dupB], lastSeenAt: null });
    const hardware = payload.topics[0]; // position 0
    const ai = payload.topics[1];
    expect(hardware.items.some((i) => i.id === 300)).toBe(true);
    expect(ai.items.some((i) => i.id === 301)).toBe(false);
  });

  it("still shows a topic's own copy when a duplicate elsewhere was capped out, not shown", () => {
    // 31 hardware items newer than the dup push the dup's canonical URL past the
    // 30-cap in topic 1; the AI copy must then still appear (only *kept* URLs suppress).
    const filler = Array.from({ length: 31 }, (_, i) => ({
      id: 400 + i, source_id: 10, guid: `f${i}`, url: `https://t/f${i}`, canonical_url: `https://t/f${i}`,
      title: `filler ${i}`, excerpt: "", author: null,
      published_at: `2026-07-04T11:${String(10 + (i % 40)).padStart(2, "0")}:00.000Z`,
      fetched_at: "2026-07-04T11:59:00.000Z", thumbnail_url: null,
    }));
    const dupOld = {
      id: 500, source_id: 10, guid: "old", url: "https://s.test/old",
      canonical_url: "https://s.test/old", title: "Old dup", excerpt: "", author: null,
      published_at: "2026-07-01T00:00:00.000Z", fetched_at: "2026-07-01T00:00:00.000Z", thumbnail_url: null,
    };
    const dupAiCopy = { ...dupOld, id: 501, source_id: 11, guid: "old2", url: "https://s.test/old?ref=x" };
    const payload = buildNewsPagePayload({
      topics, sources, items: [...filler, dupOld, dupAiCopy], lastSeenAt: null,
    });
    expect(payload.topics[0].items.some((i) => i.id === 500)).toBe(false); // capped out
    expect(payload.topics[1].items.some((i) => i.id === 501)).toBe(true);  // not suppressed
  });

  it("muted titles are filtered per topic, before the cap and before cross-topic dedup", () => {
    const mutedTopics = topics.map((t) => (t.id === 1 ? { ...t, muted_terms: '["GPU"]' } : t));
    // items[0] (id 100, "GPU news") belongs to topic 1's source
    const aiCopy = { ...items[0], id: 900, source_id: 11, guid: "copy", url: "https://t/a", canonical_url: "https://t/a" };
    const payload = buildNewsPagePayload({ topics: mutedTopics, sources, items: [...items, aiCopy], lastSeenAt: null });
    const hardware = payload.topics[0];
    const ai = payload.topics[1];
    expect(hardware.items.some((i) => i.id === 100)).toBe(false); // muted in topic 1
    expect(ai.items.some((i) => i.id === 900)).toBe(true); // NOT suppressed cross-topic by the muted copy
    expect(hardware.mutedTerms).toEqual(["GPU"]);
    expect(ai.mutedTerms).toEqual([]);
  });
});
