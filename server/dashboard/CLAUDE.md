# Server Dashboard Map

Engine for the `/api/dashboard/current` envelope: cache rows, refresh planning/scheduling/backoff, the per-provider fetch-timeout race, background in-flight dedup, system-status composition, and final response shaping. Entry point is `current-service.ts`, driven by `server/routes/dashboard.ts` and `server/routes/calendar.ts`. Provider-specific fetch/publish/maintenance behavior lives in `current-providers/` (see its map).

## Files

- `current-service.ts` — the five public entrypoints + response composition; wires store/model/runner together
- `current-types.ts` — server-only provider, context, dependency, and payload contracts
- `current-sources.ts` — cache-key registry + pure row/health helpers (TTL, usable-payload, content key)
- `current-events.ts` — SSE event fan-out for current-dashboard changes
- `currentSystemStatusModel.ts` — pure provider-health → systemStatus projection
- `currentRefreshPlanModel.ts` — pure refresh planning: `(rows, opts) → { scheduled, skipped }`
- `currentCacheStore.ts` — all `ea_current_data_cache` reads/writes (load, save, mark-failed, mark-refreshing)
- `currentRefreshRunner.ts` — async orchestration: fetch-timeout race, refreshRows, background dedup map

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- The entrypoints stay thin coordinators: pure decisions live in the `*Model` files, persistence in `currentCacheStore.ts`, async/timeout/dedup in `currentRefreshRunner.ts`.
- The `BACKGROUND_REFRESH_IN_FLIGHT` map + its two `__*ForTests` helpers live only in `currentRefreshRunner.ts`; `current-service.ts` re-exports the helpers so tests resolve them from the `current-service.ts` entry point.

## Related

- `server/routes/dashboard.ts`, `server/routes/calendar.ts` — HTTP surfaces consuming the public exports
- `server/dashboard/current-providers/` — per-source fetch/publish/maintenance modules (see its map)
