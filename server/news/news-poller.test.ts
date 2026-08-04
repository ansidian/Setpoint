// server/news/news-poller.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb } from "../snapshots/snapshot-test-fixtures.ts";
import type { Value } from "@libsql/client";
import {
  normalizeFeedItem, pruneNewsItems, stopNewsPollWorker,
  parseRetryAfterAt, startNewsPollWorker, sweepNewsSources, syncNewsSource,
} from "./news-poller.ts";
import type { FeedFetchResponse, NewsFetch } from "./news-poller.ts";
import type { NewsSourceRow } from "./news-model.ts";

type MigratedDb = Awaited<ReturnType<typeof createMigratedDb>>;

const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel><title>Test Feed</title>
    <item>
      <title>Big &amp; bold GPU</title>
      <link>https://site.test/a?utm_source=rss</link>
      <guid>tag:site.test,a</guid>
      <pubDate>Fri, 03 Jul 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>Some <b>html</b> excerpt</p>]]></description>
      <media:thumbnail url="https://site.test/a.jpg"/>
    </item>
    <item>
      <title>Second</title>
      <link>https://site.test/b</link>
      <guid>tag:site.test,b</guid>
    </item>
  </channel>
</rss>`;

function mockResponse({
  status = 200,
  body = "",
  headers = {},
  url = "",
}: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  url?: string;
} = {}): FeedFetchResponse {
  return {
    status,
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

describe("parseRetryAfterAt", () => {
  it("accepts both delta seconds and HTTP dates", () => {
    const now = new Date("2026-07-04T12:00:00.000Z");
    expect(parseRetryAfterAt("90", now)).toBe("2026-07-04T12:01:30.000Z");
    expect(parseRetryAfterAt("Sat, 04 Jul 2026 12:05:00 GMT", now))
      .toBe("2026-07-04T12:05:00.000Z");
    expect(parseRetryAfterAt("not-a-window", now)).toBeNull();
  });

  it("preserves an expired HTTP date so it does not trigger the fallback cooldown", () => {
    expect(parseRetryAfterAt(
      "Sat, 04 Jul 2026 11:59:00 GMT",
      new Date("2026-07-04T12:00:00.000Z"),
    )).toBe("2026-07-04T11:59:00.000Z");
  });

  it("rejects delta seconds outside the JavaScript Date range", () => {
    expect(parseRetryAfterAt(
      "8640000000001",
      new Date("2026-07-04T12:00:00.000Z"),
    )).toBeNull();
  });
});

async function seedSource(db: MigratedDb, overrides: Record<string, Value> = {}): Promise<NewsSourceRow> {
  await db.execute({ sql: "INSERT INTO ea_news_topics (user_id, name, position) VALUES ('u1', 'T', 0)", args: [] });
  const cols: Record<string, Value> = {
    topic_id: 1, kind: "rss", title: "Feed", feed_url: "https://site.test/feed",
    enabled: 1, consecutive_failures: 0, ...overrides,
  };
  const keys = Object.keys(cols);
  await db.execute({
    sql: `INSERT INTO ea_news_sources (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    args: keys.map((k) => cols[k]!),
  });
  const row = await db.execute("SELECT * FROM ea_news_sources WHERE id = 1");
  return row.rows[0]! as unknown as NewsSourceRow;
}

describe("normalizeFeedItem", () => {
  it("canonicalizes, strips html, extracts thumbnail and iso date", async () => {
    // parse via the real parser to get rss-parser's field names
    const { parseFeedXml } = await import("./news-poller.ts");
    const feed = await parseFeedXml(RSS_XML);
    const item = normalizeFeedItem(feed.items[0]!);
    expect(item).toMatchObject({
      guid: "tag:site.test,a",
      url: "https://site.test/a?utm_source=rss",
      canonical_url: "https://site.test/a",
      title: "Big & bold GPU",
      excerpt: "Some html excerpt",
      published_at: "2026-07-03T10:00:00.000Z",
      thumbnail_url: "https://site.test/a.jpg",
    });
  });

  it("extracts a media:group-nested thumbnail (YouTube feeds)", async () => {
    const { parseFeedXml } = await import("./news-poller.ts");
    const feed = await parseFeedXml(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <id>yt:video:abc123</id>
    <title>GPU review</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <published>2026-07-03T10:00:00+00:00</published>
    <media:group>
      <media:title>GPU review</media:title>
      <media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
      <media:description>desc</media:description>
    </media:group>
  </entry>
</feed>`);
    const item = normalizeFeedItem(feed.items[0]!);
    expect(item.thumbnail_url).toBe("https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  });

  it("falls back to the first <img> in content html when no metadata thumbnail exists", async () => {
    const { parseFeedXml } = await import("./news-poller.ts");
    const feed = await parseFeedXml(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://site.test/verge-style</id>
    <title>Story</title>
    <link rel="alternate" href="https://site.test/verge-style"/>
    <content type="html">&lt;figure&gt;&lt;img alt="hero" src="https://cdn.site.test/hero.jpg" /&gt;&lt;/figure&gt;&lt;p&gt;Body text&lt;/p&gt;</content>
  </entry>
</feed>`);
    const item = normalizeFeedItem(feed.items[0]!);
    expect(item.thumbnail_url).toBe("https://cdn.site.test/hero.jpg");
  });

  it("prefers a metadata thumbnail over content-html images", async () => {
    const { parseFeedXml } = await import("./news-poller.ts");
    const feed = await parseFeedXml(`<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel><title>T</title>
    <item>
      <title>Story</title>
      <link>https://site.test/c</link>
      <guid>tag:site.test,c</guid>
      <media:thumbnail url="https://site.test/meta.jpg"/>
      <content:encoded><![CDATA[<img src="https://site.test/inline.jpg"><p>body</p>]]></content:encoded>
    </item>
  </channel>
</rss>`);
    const item = normalizeFeedItem(feed.items[0]!);
    expect(item.thumbnail_url).toBe("https://site.test/meta.jpg");
  });
});

describe("syncNewsSource", () => {
  let db: MigratedDb;
  beforeEach(async () => { db = await createMigratedDb(); });

  it("inserts items on 200 and stores validators; re-sync with 304 adds nothing", async () => {
    const source = await seedSource(db);
    const fetchImpl = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({
      status: 200, body: RSS_XML,
      headers: { etag: '"v1"', "last-modified": "Fri, 03 Jul 2026 10:00:00 GMT" },
      url: "https://site.test/feed",
    }));
    const result = await syncNewsSource(source, { dbClient: db, fetchImpl });
    expect(result).toMatchObject({ ok: true, status: "200", inserted: 2 });

    const updated = (await db.execute("SELECT * FROM ea_news_sources WHERE id = 1")).rows[0]! as unknown as NewsSourceRow;
    expect(updated.etag).toBe('"v1"');
    expect(updated.last_status).toBe("200");

    const fetch304 = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 304 }));
    const second = await syncNewsSource(updated, { dbClient: db, fetchImpl: fetch304 });
    expect(second).toMatchObject({ ok: true, status: "304" });
    // test-architecture: allow-boundary-interaction -- Feed fetch is an outbound provider boundary; conditional headers, pause/resume admission, URL selection, and dedup are transport contracts.
    expect((fetch304.mock.calls[0]![1]?.headers as Record<string, string>)["If-None-Match"]).toBe('"v1"');
    const count = (await db.execute("SELECT COUNT(*) AS n FROM ea_news_items")).rows[0]!.n;
    expect(Number(count)).toBe(2);
  });

  it("re-inserting the same guid is a no-op (upsert dedup)", async () => {
    const source = await seedSource(db);
    const fetchImpl = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));
    await syncNewsSource(source, { dbClient: db, fetchImpl });
    const again = await syncNewsSource(source, { dbClient: db, fetchImpl });
    expect(again.inserted).toBe(0);
  });

  it("persists a redirected final URL for rss sources", async () => {
    const source = await seedSource(db);
    const fetchImpl = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({
      status: 200, body: RSS_XML, url: "https://site.test/feeds.xml",
    }));
    await syncNewsSource(source, { dbClient: db, fetchImpl });
    const updated = (await db.execute("SELECT feed_url FROM ea_news_sources WHERE id = 1")).rows[0]!;
    expect(updated.feed_url).toBe("https://site.test/feeds.xml");
  });

  it("records failures (http error, timeout, parse error) and increments the counter", async () => {
    const source = await seedSource(db);
    const fetch500 = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 500 }));
    expect((await syncNewsSource(source, { dbClient: db, fetchImpl: fetch500 })).ok).toBe(false);

    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchAbort = vi.fn<NewsFetch>().mockRejectedValue(abortErr);
    await syncNewsSource(source, { dbClient: db, fetchImpl: fetchAbort });

    const fetchGarbage = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 200, body: "not xml at all {" }));
    await syncNewsSource(source, { dbClient: db, fetchImpl: fetchGarbage });

    const row = (await db.execute("SELECT consecutive_failures, last_status FROM ea_news_sources WHERE id = 1")).rows[0]!;
    expect(Number(row.consecutive_failures)).toBe(3);
    expect(row.last_status).toBe("parse_error");
  });

  it("persists a 429 Retry-After window and clears it after a successful fetch", async () => {
    const source = await seedSource(db);
    const fetch429 = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({
      status: 429,
      headers: { "retry-after": "120" },
    }));
    await syncNewsSource(source, {
      dbClient: db,
      fetchImpl: fetch429,
      now: new Date("2026-07-04T12:00:00.000Z"),
    });
    const limited = (await db.execute(
      "SELECT * FROM ea_news_sources WHERE id = 1",
    )).rows[0]! as unknown as NewsSourceRow;
    expect(limited.retry_after_at).toBe("2026-07-04T12:02:00.000Z");

    const fetch200 = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));
    await syncNewsSource(limited, {
      dbClient: db,
      fetchImpl: fetch200,
      now: new Date("2026-07-04T12:03:00.000Z"),
    });
    const recovered = (await db.execute(
      "SELECT retry_after_at FROM ea_news_sources WHERE id = 1",
    )).rows[0]!;
    expect(recovered.retry_after_at).toBeNull();
  });
});

describe("pruneNewsItems", () => {
  it("keeps the newest 30 per source even when old, deletes older-than-14d beyond that", async () => {
    const db = await createMigratedDb();
    await seedSource(db);
    const NOW = new Date("2026-07-04T12:00:00.000Z");
    const old = "2026-05-01T00:00:00.000Z"; // > 14 days before NOW
    for (let i = 0; i < 40; i += 1) {
      await db.execute({
        sql: `INSERT INTO ea_news_items (source_id, guid, url, canonical_url, title, published_at, fetched_at)
              VALUES (1, ?, ?, ?, ?, ?, ?)`,
        args: [`g${i}`, `https://x/${i}`, `https://x/${i}`, `t${i}`,
          `2026-05-01T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`, old],
      });
    }
    await pruneNewsItems({ dbClient: db, now: NOW });
    const count = (await db.execute("SELECT COUNT(*) AS n FROM ea_news_items")).rows[0]!.n;
    expect(Number(count)).toBe(30);
  });
});

describe("sweepNewsSources + worker", () => {
  afterEach(() => stopNewsPollWorker());

  it("skips backed-off sources and sweeps due ones", async () => {
    const db = await createMigratedDb();
    await seedSource(db, { consecutive_failures: 9, last_fetch_at: "2026-07-04T11:59:00.000Z" });
    const fetchImpl = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));
    const result = await sweepNewsSources({
      dbClient: db, fetchImpl, now: new Date("2026-07-04T12:00:00.000Z"), staggerMs: 0,
    });
    expect(result.swept).toBe(0);
    // test-architecture: allow-boundary-interaction -- Feed fetch is the outbound network boundary; backed-off sources must produce no provider request, which durable state alone cannot establish.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches at most one reddit source per sweep, deferring the rest without recording failures", async () => {
    const db = await createMigratedDb();
    await db.execute("INSERT INTO ea_news_topics (user_id, name, position) VALUES ('u1', 'T', 0)");
    for (const feedUrl of [
      "https://www.reddit.com/r/news/.rss",
      "https://www.reddit.com/r/politics/.rss",
      "https://site.test/feed",
    ]) {
      await db.execute({
        sql: `INSERT INTO ea_news_sources (topic_id, kind, title, feed_url, enabled, consecutive_failures)
              VALUES (1, 'rss', ?, ?, 1, 0)`,
        args: [feedUrl, feedUrl],
      });
    }
    const fetchImpl = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));
    const result = await sweepNewsSources({ dbClient: db, fetchImpl, staggerMs: 0 });
    expect(result.swept).toBe(2);
    // test-architecture: allow-boundary-interaction -- Feed fetch is an outbound provider boundary; conditional headers, pause/resume admission, URL selection, and dedup are transport contracts.
    const fetchedUrls = fetchImpl.mock.calls.map(([url]) => url);
    expect(fetchedUrls.filter((url) => url.includes("reddit.com"))).toHaveLength(1);
    expect(fetchedUrls).toContain("https://site.test/feed");
    const deferred = (await db.execute(
      "SELECT * FROM ea_news_sources WHERE feed_url LIKE '%reddit%' AND last_fetch_at IS NULL",
    )).rows;
    expect(deferred).toHaveLength(1);
    expect(Number(deferred[0]!.consecutive_failures)).toBe(0);
  });

  it("pauses every reddit source for six hours after one receives 429, then retries the least-recent one", async () => {
    const db = await createMigratedDb();
    await db.execute("INSERT INTO ea_news_topics (user_id, name, position) VALUES ('u1', 'T', 0)");
    for (const [title, feedUrl, lastFetchAt] of [
      ["r/news", "https://www.reddit.com/r/news/.rss", "2026-07-04T11:20:00.000Z"],
      ["r/politics", "https://www.reddit.com/r/politics/.rss", "2026-07-04T11:40:00.000Z"],
      ["site", "https://site.test/feed", "2026-07-04T11:50:00.000Z"],
    ] as Array<[string, string, string]>) {
      await db.execute({
        sql: `INSERT INTO ea_news_sources
                (topic_id, kind, title, feed_url, enabled, consecutive_failures, last_fetch_at)
              VALUES (1, 'rss', ?, ?, 1, 0, ?)`,
        args: [title, feedUrl, lastFetchAt],
      });
    }
    let sentReddit429 = false;
    const fetchImpl = vi.fn<NewsFetch>(async (url: string) => {
      if (url === "https://www.reddit.com/r/news/.rss" && !sentReddit429) {
        sentReddit429 = true;
        return mockResponse({ status: 429 });
      }
      return mockResponse({ status: 200, body: RSS_XML });
    });

    await sweepNewsSources({
      dbClient: db, fetchImpl, now: new Date("2026-07-04T12:00:00.000Z"), staggerMs: 0,
    });
    const limited = (await db.execute(
      "SELECT last_status, last_fetch_at FROM ea_news_sources WHERE title = 'r/news'",
    )).rows[0]!;
    expect(limited.last_status).toBe("429");
    expect(limited.last_fetch_at).toBe("2026-07-04T12:00:00.000Z");

    fetchImpl.mockClear();
    const duringCooldown = await sweepNewsSources({
      dbClient: db, fetchImpl, now: new Date("2026-07-04T13:00:00.000Z"), staggerMs: 0,
    });
    expect(duringCooldown.swept).toBe(1);
    // test-architecture: allow-boundary-interaction -- Feed fetch is an outbound provider boundary; conditional headers, pause/resume admission, URL selection, and dedup are transport contracts.
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["https://site.test/feed"]);

    fetchImpl.mockClear();
    const afterCooldown = await sweepNewsSources({
      dbClient: db, fetchImpl, now: new Date("2026-07-04T18:00:00.000Z"), staggerMs: 0,
    });
    expect(afterCooldown.swept).toBe(2);
    // test-architecture: allow-boundary-interaction -- Feed fetch is an outbound provider boundary; conditional headers, pause/resume admission, URL selection, and dedup are transport contracts.
    const resumedUrls = fetchImpl.mock.calls.map(([url]) => url);
    expect(resumedUrls.filter((url) => url.includes("reddit.com")))
      .toEqual(["https://www.reddit.com/r/politics/.rss"]);
    expect(resumedUrls).toContain("https://site.test/feed");
  });

  it("uses a persisted Retry-After window instead of the six-hour fallback", async () => {
    const db = await createMigratedDb();
    await db.execute("INSERT INTO ea_news_topics (user_id, name, position) VALUES ('u1', 'T', 0)");
    await db.execute({
      sql: `INSERT INTO ea_news_sources
              (topic_id, kind, title, feed_url, enabled, consecutive_failures,
               last_fetch_at, last_status, retry_after_at)
            VALUES (1, 'rss', 'r/news', 'https://www.reddit.com/r/news/.rss',
                    1, 1, '2026-07-04T12:00:00.000Z', '429', '2026-07-04T12:02:00.000Z')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO ea_news_sources
              (topic_id, kind, title, feed_url, enabled, consecutive_failures, last_fetch_at)
            VALUES (1, 'rss', 'r/politics', 'https://www.reddit.com/r/politics/.rss',
                    1, 0, '2026-07-04T11:40:00.000Z')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO ea_news_sources
              (topic_id, kind, title, feed_url, enabled, consecutive_failures, last_fetch_at)
            VALUES (1, 'rss', 'site', 'https://site.test/feed',
                    1, 0, '2026-07-04T11:50:00.000Z')`,
      args: [],
    });
    const fetchImpl = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));

    await sweepNewsSources({
      dbClient: db, fetchImpl, now: new Date("2026-07-04T12:01:00.000Z"), staggerMs: 0,
    });
    // test-architecture: allow-boundary-interaction -- Feed fetch is an outbound provider boundary; conditional headers, pause/resume admission, URL selection, and dedup are transport contracts.
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["https://site.test/feed"]);

    fetchImpl.mockClear();
    await sweepNewsSources({
      dbClient: db, fetchImpl, now: new Date("2026-07-04T12:02:01.000Z"), staggerMs: 0,
    });
    // test-architecture: allow-boundary-interaction -- Feed fetch is an outbound provider boundary; conditional headers, pause/resume admission, URL selection, and dedup are transport contracts.
    const resumedUrls = fetchImpl.mock.calls.map(([url]) => url);
    expect(resumedUrls.filter((url) => url.includes("reddit.com")))
      .toEqual(["https://www.reddit.com/r/politics/.rss"]);
    expect(resumedUrls).toContain("https://site.test/feed");
  });

  it("keeps the shared Reddit cooldown when the source that received 429 is disabled", async () => {
    const db = await createMigratedDb();
    await db.execute("INSERT INTO ea_news_topics (user_id, name, position) VALUES ('u1', 'T', 0)");
    await db.execute({
      sql: `INSERT INTO ea_news_sources
              (topic_id, kind, title, feed_url, enabled, consecutive_failures,
               last_fetch_at, last_status, retry_after_at)
            VALUES (1, 'rss', 'r/news', 'https://www.reddit.com/r/news/.rss',
                    0, 1, '2026-07-04T12:00:00.000Z', '429', '2026-07-04T12:05:00.000Z')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO ea_news_sources
              (topic_id, kind, title, feed_url, enabled, consecutive_failures, last_fetch_at)
            VALUES (1, 'rss', 'r/politics', 'https://www.reddit.com/r/politics/.rss',
                    1, 0, '2026-07-04T11:40:00.000Z')`,
      args: [],
    });
    const fetchImpl = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));

    const result = await sweepNewsSources({
      dbClient: db, fetchImpl, now: new Date("2026-07-04T12:01:00.000Z"), staggerMs: 0,
    });

    expect(result.swept).toBe(0);
    // test-architecture: allow-boundary-interaction -- Feed fetch is the outbound network boundary; a persisted shared-host cooldown must suppress every Reddit request while active.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rotates deferred same-host sources: least recently fetched goes first", async () => {
    const db = await createMigratedDb();
    await db.execute("INSERT INTO ea_news_topics (user_id, name, position) VALUES ('u1', 'T', 0)");
    await db.execute(`INSERT INTO ea_news_sources (topic_id, kind, title, feed_url, enabled, consecutive_failures, last_fetch_at)
                      VALUES (1, 'rss', 'r/news', 'https://www.reddit.com/r/news/.rss', 1, 0, '2026-07-04T11:40:00.000Z')`);
    await db.execute(`INSERT INTO ea_news_sources (topic_id, kind, title, feed_url, enabled, consecutive_failures, last_fetch_at)
                      VALUES (1, 'rss', 'r/politics', 'https://www.reddit.com/r/politics/.rss', 1, 0, '2026-07-04T11:20:00.000Z')`);
    const fetchImpl = vi.fn<NewsFetch>().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));
    const result = await sweepNewsSources({ dbClient: db, fetchImpl, staggerMs: 0 });
    expect(result.swept).toBe(1);
    // test-architecture: allow-boundary-interaction -- Feed fetch is an outbound provider boundary; conditional headers, pause/resume admission, URL selection, and dedup are transport contracts.
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://www.reddit.com/r/politics/.rss");
  });

  it("startNewsPollWorker guards against double start", async () => {
    const db = await createMigratedDb();
    expect(startNewsPollWorker({ dbClient: db, intervalMs: 60_000 }).started).toBe(true);
    expect(startNewsPollWorker({ dbClient: db, intervalMs: 60_000 }).started).toBe(false);
  });
});
