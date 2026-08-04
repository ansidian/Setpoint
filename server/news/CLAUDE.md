# Server News Map

News tab v1 domain: RSS/Atom polling into a rolling headline window, per-topic
source bundles, and the paste-URL add-source flow. No AI classification or
summarization — metadata only, read-at-source. HTTP surface is
`server/routes/news.ts` (see `server/routes/CLAUDE.md`).

## Files

- `news-model.ts` — pure domain rules: canonical URL dedup, HN feed URL
  building, poll-backoff predicate, excerpt sanitization, page-payload shaping
  (`buildNewsPagePayload`, incl. cross-topic dedup — first topic by position
  wins, only post-cap kept URLs suppress later copies — and mute-term
  filtering: `parseMutedTerms`/`sanitizeMutedTerms`/`isTitleMuted`,
  case-insensitive word-boundary match against the title only, applied before
  the mute/dedup/30-cap ordering)
- `news-catalog.ts` — checked-in starter catalog constant (eight topic bundles);
  import copies rows into the owner's tables, catalog edits never mutate
  followed feeds
- `feed-autodiscovery.ts` — pure HTML `<link rel=alternate>` parsing +
  feed-shaped-response sniffing, used by the add-source preview flow
- `news-poller.ts` — in-process interval worker: conditional-GET fetch,
  RSS/Atom parsing (`rss-parser`), item upsert, retention pruning, sweep/worker
  lifecycle, and shared-host Reddit cooldown. Provider `Retry-After` windows
  are persisted; a six-hour host cooldown is the fallback when absent.
- `news-preview.ts` — add-source validation: fetch the pasted URL, sample it
  directly if it's a feed, else follow one advertised autodiscovery link
- `migration.test.ts` — permanent guard for `026_news.sql`'s schema shape,
  `027_news_mute_terms.sql`'s topic filter column, and
  `029_news_retry_after.sql`'s persisted source cooldown (lives here, not with
  the migration files)

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- All feed HTTP goes through `fetchFeedResponse` (10s `AbortController` timeout,
  descriptive `SetpointNews/1.0` User-Agent) — never call `fetch` directly for
  feed URLs.
- `kind='hn'` sources have no stored `feed_url` of record; it's rebuilt from
  `hn_query`/`min_points` via `buildHnFeedUrl` on every poll and every preview.
- Retention keeps the newest 30 items per source regardless of age, deleting
  only the excess when older than 14 days — a deliberate deviation from pure
  age-based deletion so quiet feeds don't go empty (see the design spec).
- Backoff: 5 consecutive failures pause a source to a ~6h retry cadence
  (`shouldPollSource`). Any Reddit 429 also pauses every enabled Reddit source
  until its persisted `Retry-After` expires, falling back to six hours when the
  header is missing or invalid. Feed errors never break the page.

## Related

- `server/routes/news.ts` — HTTP surface (topics/sources CRUD incl. PATCH
  `/topics/:id` name and/or `mutedTerms`, catalog import, preview,
  seen-marker, manual refresh)
- `src/components/news/` — frontend consumer (see its map)
- `docs/exec-plans/completed/2026-07-04-news-tab-design.md` — design spec
