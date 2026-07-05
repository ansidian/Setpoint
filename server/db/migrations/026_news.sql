-- server/db/migrations/026_news.sql
-- News tab v1: topic bundles of feeds, polled headlines, and the single
-- seen-marker. Items are a rolling window (pruned by the poller), never an
-- archive. kind='hn' sources build their hnrss.org URL from hn_query+min_points.
CREATE TABLE ea_news_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ea_news_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'rss',
  title TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  site_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  hn_query TEXT,
  min_points INTEGER,
  etag TEXT,
  last_modified TEXT,
  last_fetch_at TEXT,
  last_status TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_news_sources_topic ON ea_news_sources(topic_id);

CREATE TABLE ea_news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  guid TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  author TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  thumbnail_url TEXT,
  UNIQUE (source_id, guid)
);
CREATE INDEX idx_news_items_source_recency
  ON ea_news_items(source_id, published_at DESC, fetched_at DESC);

ALTER TABLE ea_settings ADD COLUMN news_last_seen_at TEXT;
