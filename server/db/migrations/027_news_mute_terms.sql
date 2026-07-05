-- server/db/migrations/027_news_mute_terms.sql
-- Per-topic keyword mute filters: JSON array of strings, matched
-- case-insensitively (word-boundary, title-only) at page-build time.
ALTER TABLE ea_news_topics ADD COLUMN muted_terms TEXT NOT NULL DEFAULT '[]';
