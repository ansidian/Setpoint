// server/news/news-poller.test.js
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb } from "../snapshots/snapshot-test-fixtures.js";
import {
  normalizeFeedItem, pruneNewsItems, stopNewsPollWorker,
  startNewsPollWorker, sweepNewsSources, syncNewsSource,
} from "./news-poller.js";

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

function mockResponse({ status = 200, body = "", headers = {}, url = "" } = {}) {
  return {
    status,
    url,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

async function seedSource(db, overrides = {}) {
  await db.execute({ sql: "INSERT INTO ea_news_topics (user_id, name, position) VALUES ('u1', 'T', 0)", args: [] });
  const cols = {
    topic_id: 1, kind: "rss", title: "Feed", feed_url: "https://site.test/feed",
    enabled: 1, consecutive_failures: 0, ...overrides,
  };
  const keys = Object.keys(cols);
  await db.execute({
    sql: `INSERT INTO ea_news_sources (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    args: keys.map((k) => cols[k]),
  });
  const row = await db.execute("SELECT * FROM ea_news_sources WHERE id = 1");
  return row.rows[0];
}

describe("normalizeFeedItem", () => {
  it("canonicalizes, strips html, extracts thumbnail and iso date", async () => {
    // parse via the real parser to get rss-parser's field names
    const { parseFeedXml } = await import("./news-poller.js");
    const feed = await parseFeedXml(RSS_XML);
    const item = normalizeFeedItem(feed.items[0]);
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
});

describe("syncNewsSource", () => {
  let db;
  beforeEach(async () => { db = await createMigratedDb(); });

  it("inserts items on 200 and stores validators; re-sync with 304 adds nothing", async () => {
    const source = await seedSource(db);
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse({
      status: 200, body: RSS_XML,
      headers: { etag: '"v1"', "last-modified": "Fri, 03 Jul 2026 10:00:00 GMT" },
      url: "https://site.test/feed",
    }));
    const result = await syncNewsSource(source, { dbClient: db, fetchImpl });
    expect(result).toMatchObject({ ok: true, status: "200", inserted: 2 });

    const updated = (await db.execute("SELECT * FROM ea_news_sources WHERE id = 1")).rows[0];
    expect(updated.etag).toBe('"v1"');
    expect(updated.last_status).toBe("200");

    const fetch304 = vi.fn().mockResolvedValue(mockResponse({ status: 304 }));
    const second = await syncNewsSource(updated, { dbClient: db, fetchImpl: fetch304 });
    expect(second).toMatchObject({ ok: true, status: "304" });
    expect(fetch304.mock.calls[0][1].headers["If-None-Match"]).toBe('"v1"');
    const count = (await db.execute("SELECT COUNT(*) AS n FROM ea_news_items")).rows[0].n;
    expect(Number(count)).toBe(2);
  });

  it("re-inserting the same guid is a no-op (upsert dedup)", async () => {
    const source = await seedSource(db);
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));
    await syncNewsSource(source, { dbClient: db, fetchImpl });
    const again = await syncNewsSource(source, { dbClient: db, fetchImpl });
    expect(again.inserted).toBe(0);
  });

  it("persists a redirected final URL for rss sources", async () => {
    const source = await seedSource(db);
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse({
      status: 200, body: RSS_XML, url: "https://site.test/feeds.xml",
    }));
    await syncNewsSource(source, { dbClient: db, fetchImpl });
    const updated = (await db.execute("SELECT feed_url FROM ea_news_sources WHERE id = 1")).rows[0];
    expect(updated.feed_url).toBe("https://site.test/feeds.xml");
  });

  it("records failures (http error, timeout, parse error) and increments the counter", async () => {
    const source = await seedSource(db);
    const fetch500 = vi.fn().mockResolvedValue(mockResponse({ status: 500 }));
    expect((await syncNewsSource(source, { dbClient: db, fetchImpl: fetch500 })).ok).toBe(false);

    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchAbort = vi.fn().mockRejectedValue(abortErr);
    await syncNewsSource(source, { dbClient: db, fetchImpl: fetchAbort });

    const fetchGarbage = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: "not xml at all {" }));
    await syncNewsSource(source, { dbClient: db, fetchImpl: fetchGarbage });

    const row = (await db.execute("SELECT consecutive_failures, last_status FROM ea_news_sources WHERE id = 1")).rows[0];
    expect(Number(row.consecutive_failures)).toBe(3);
    expect(row.last_status).toBe("parse_error");
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
    const count = (await db.execute("SELECT COUNT(*) AS n FROM ea_news_items")).rows[0].n;
    expect(Number(count)).toBe(30);
  });
});

describe("sweepNewsSources + worker", () => {
  afterEach(() => stopNewsPollWorker());

  it("skips backed-off sources and sweeps due ones", async () => {
    const db = await createMigratedDb();
    await seedSource(db, { consecutive_failures: 9, last_fetch_at: "2026-07-04T11:59:00.000Z" });
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: RSS_XML }));
    const result = await sweepNewsSources({
      dbClient: db, fetchImpl, now: new Date("2026-07-04T12:00:00.000Z"), staggerMs: 0,
    });
    expect(result.swept).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("startNewsPollWorker guards against double start", async () => {
    const db = await createMigratedDb();
    expect(startNewsPollWorker({ dbClient: db, intervalMs: 60_000 }).started).toBe(true);
    expect(startNewsPollWorker({ dbClient: db, intervalMs: 60_000 }).started).toBe(false);
  });
});
