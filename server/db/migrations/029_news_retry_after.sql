-- Persist provider-directed retry windows so host-level news cooldowns survive
-- worker restarts. NULL means the poller's ordinary fallback policy applies.
ALTER TABLE ea_news_sources ADD COLUMN retry_after_at TEXT;
