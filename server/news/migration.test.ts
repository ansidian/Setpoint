// server/news/migration.test.js
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMigratedDb } from "../snapshots/snapshot-test-fixtures.ts";

describe("news migrations", () => {
  it("creates the news tables with the expected columns", async () => {
    const db = await createMigratedDb();
    const topics = await db.execute("PRAGMA table_info(ea_news_topics)");
    expect(topics.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining(["id", "user_id", "name", "position", "created_at", "muted_terms"]),
    );
    const sources = await db.execute("PRAGMA table_info(ea_news_sources)");
    expect(sources.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "id", "topic_id", "kind", "title", "feed_url", "site_url", "enabled",
        "hn_query", "min_points", "etag", "last_modified", "last_fetch_at",
        "last_status", "consecutive_failures", "retry_after_at",
      ]),
    );
    const items = await db.execute("PRAGMA table_info(ea_news_items)");
    expect(items.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "id", "source_id", "guid", "url", "canonical_url", "title", "excerpt",
        "author", "published_at", "fetched_at", "thumbnail_url",
      ]),
    );
    const settings = await db.execute("PRAGMA table_info(ea_settings)");
    expect(settings.rows.map((r) => r.name)).toContain("news_last_seen_at");
  });

  it("enforces the (source_id, guid) uniqueness used for upsert dedup", async () => {
    const db = await createMigratedDb();
    await db.execute({ sql: "INSERT INTO ea_news_topics (user_id, name, position) VALUES ('u1', 'AI', 0)", args: [] });
    await db.execute({
      sql: "INSERT INTO ea_news_sources (topic_id, kind, title, feed_url) VALUES (1, 'rss', 'Feed', 'https://x/feed')",
      args: [],
    });
    const insert = {
      sql: `INSERT INTO ea_news_items (source_id, guid, url, canonical_url, title, fetched_at)
            VALUES (1, 'g1', 'https://x/a', 'https://x/a', 'A', datetime('now'))`,
      args: [],
    };
    await db.execute(insert);
    await expect(db.execute(insert)).rejects.toThrow(/UNIQUE/i);
  });
});
