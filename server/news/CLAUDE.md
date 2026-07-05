# Server News Map

News tab v1 domain: RSS/Atom polling into a rolling headline window, per-topic
source bundles, and the paste-URL add-source flow. No AI classification or
summarization — metadata only, read-at-source. HTTP surface is
`server/routes/news.js` (see `server/routes/CLAUDE.md`).

## Files

- `news-model.js` — pure domain rules: canonical URL dedup, HN feed URL
  building, poll-backoff predicate, excerpt sanitization, page-payload shaping
- `news-catalog.js` — checked-in starter catalog constant (eight topic bundles);
  import copies rows into the owner's tables, catalog edits never mutate
  followed feeds
- `feed-autodiscovery.js` — pure HTML `<link rel=alternate>` parsing +
  feed-shaped-response sniffing, used by the add-source preview flow
- `news-poller.js` — in-process interval worker: conditional-GET fetch,
  RSS/Atom parsing (`rss-parser`), item upsert, retention pruning, sweep/worker
  lifecycle
- `news-preview.js` — add-source validation: fetch the pasted URL, sample it
  directly if it's a feed, else follow one advertised autodiscovery link
- `migration.test.js` — permanent guard for migration `026_news.sql`'s schema
  shape (lives here, not with the migration file)

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

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
  (`shouldPollSource`); the poller and preview never let a feed error break the
  page.

## Related

- `server/routes/news.js` — HTTP surface (topics/sources CRUD, catalog import,
  preview, seen-marker, manual refresh)
- `src/components/news/` — frontend consumer (see its map)
- `docs/exec-plans/active/2026-07-04-news-tab-design.md` — design spec
