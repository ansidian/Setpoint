# Server Dashboard Map

Engine for the `/api/dashboard/current` envelope: cache rows, refresh planning/scheduling/backoff, the per-provider fetch-timeout race, background in-flight dedup, system-status composition, and final response shaping. Entry point is `current-service.js`, driven by `server/routes/dashboard.js` and `server/routes/calendar.js`. Provider-specific fetch/publish/maintenance behavior lives in `current-providers/` (see its map).

## Files

- `current-service.js` — the five public entrypoints + response composition; wires store/model/runner together
- `current-sources.js` — cache-key registry + pure row/health helpers (TTL, usable-payload, content key)
- `current-events.js` — SSE event fan-out for current-dashboard changes
- `currentSystemStatusModel.js` — pure provider-health → systemStatus projection
- `currentRefreshPlanModel.js` — pure refresh planning: `(rows, opts) → { scheduled, skipped }`
- `currentCacheStore.js` — all `ea_current_data_cache` reads/writes (load, save, mark-failed, mark-refreshing)
- `currentRefreshRunner.js` — async orchestration: fetch-timeout race, refreshRows, background dedup map

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- The entrypoints stay thin coordinators: pure decisions live in the `*Model` files, persistence in `currentCacheStore.js`, async/timeout/dedup in `currentRefreshRunner.js`.
- The `BACKGROUND_REFRESH_IN_FLIGHT` map + its two `__*ForTests` helpers live only in `currentRefreshRunner.js`; `current-service.js` re-exports the helpers so tests resolve them from the `current-service.js` entry point.

## Related

- `server/routes/dashboard.js`, `server/routes/calendar.js` — HTTP surfaces consuming the public exports
- `server/dashboard/current-providers/` — per-source fetch/publish/maintenance modules (see its map)
