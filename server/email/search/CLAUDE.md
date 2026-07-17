# Server Email Search Map

AI search pipeline over the email index: hybrid retrieval (FTS + embeddings) and ranking. Primary consumer is Alfred's `search_email` tool (`server/alfred/alfred-tools.ts`) via `retrieveInboxAiSearch`; the indexed-search route also reads it. `email-search-embedding-worker.ts` exposes the background re-embedding hook consumed by `server/scheduler.ts`. Depends one-way on `server/email/` (reads the index; never fetches providers directly). The standalone LLM query planner and answer compiler were retired with the inbox ask-ai surface — the Alfred model calling `search_email` is the planner now.

## Files

- `email-search-query.ts` — parses search strings: intent, date range, sender
- `email-search-date-window.ts` — decides the search lookback window from email age/relevance
- `email-search-retrieval.ts` — retrieval chain: FTS → embeddings → ranking → dedupe/limit
- `email-search-ranking.ts` — re-ranks by BM25, recency, sender match
- `email-search-evidence.ts` — evidence gate: vector floor, lexical floor, field matches
- `email-search-embeddings.ts` — embedding model config: dimension, version, pricing
- `email-search-embedding-client.ts` — embedding API client
- `email-search-embedding-store.ts` — vector store: corpus load/refresh, similarity, staleness
- `email-search-embedding-worker.ts` — background re-embedding of stale corpus entries
- `email-search-cost-stats.ts` — token estimation and cost tracking for search/embeddings
- `email-search-retrieval-eval.ts` — normalizes retrieval eval fixtures for scoring
- `email-search-dev-harness.ts` — CLI harness for index status and backfill experiments
- `evals/email-search-retrieval.synthetic.json` — synthetic retrieval eval fixture (default for `npm run email-search:eval`)

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Retrieval is layered: FTS first, embeddings as a semantic supplement, then ranking — keep new signals inside `email-search-ranking.ts`.
- Cost visibility is a feature: anything that calls a model or embedding API must report through `email-search-cost-stats.ts`.

## Related

- `server/routes/briefing/email.ts` — HTTP surface for AI search answers
- `npm run email-search:eval` and `npm run ai-search:*` — CLI harnesses in `server/scripts/`
