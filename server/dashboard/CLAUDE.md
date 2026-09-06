# Server Dashboard Map

Engine for the `/api/dashboard/current` envelope: cache rows, refresh planning/scheduling/backoff, the per-provider fetch-timeout race, background in-flight dedup, system-status composition, and final response shaping. Entry point is `current-service.ts`, driven by `server/routes/dashboard.ts` and `server/routes/calendar.ts`. Provider-specific fetch/publish/maintenance behavior lives in `current-providers/` (see its map).

## Files

- `current-service.ts` — public current-dashboard entrypoints + response composition; wires store/model/runner together and exposes the read-only finance projection
- `current-service.test-utils.ts` — shared ephemeral dashboard database and external-provider fixtures for service behavior tests
- `current-types.ts` — server-only provider, context, dependency, and payload contracts
- `current-sources.ts` — cache-key registry + pure row/health helpers (TTL, usable-payload, content key)
- `current-events.ts` — SSE event fan-out for current-dashboard changes
- `currentSystemStatusModel.ts` — per-source cache/mirror freshness, reconnect evidence, impact text, and Connections repair actions → systemStatus
- `currentRefreshPlanModel.ts` — pure refresh planning: `(rows, opts) → { scheduled, skipped }`
- `currentCacheStore.ts` — all `ea_current_data_cache` reads/writes (load, save, mark-failed, mark-refreshing)
- `currentRefreshRunner.ts` — async orchestration: fetch-timeout race, refreshRows, background dedup map
- `dashboard-finance.ts` — read-only finance card facade: bounded local Actual spending, freshness, and independently degraded import activity
- `dashboard-finance-model.ts` — Pacific month-to-date comparison ranges and expense/category aggregation

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- The entrypoints stay thin coordinators: pure decisions live in the `*Model` files, persistence in `currentCacheStore.ts`, async/timeout/dedup in `currentRefreshRunner.ts`.
- The `BACKGROUND_REFRESH_IN_FLIGHT` map and its lifecycle clear operation live only in `currentRefreshRunner.ts`; `current-service.ts` re-exports that operation so callers share one runtime identity.

## Related

- `server/routes/dashboard.ts`, `server/routes/calendar.ts` — HTTP surfaces consuming the public exports
- `server/dashboard/current-providers/` — per-source fetch/publish/maintenance modules (see its map)
