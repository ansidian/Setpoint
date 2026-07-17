# Server Dashboard Current-Providers Map

Per-source modules for the `/api/dashboard/current` engine. Each provider owns its own fetch, change-publish, backoff, and maintenance behavior behind a uniform interface (`key`, `fetchFresh`, `onRefreshed`, and the optional refresh-reason hooks). The registry in `index.ts` is consumed by `server/dashboard/current-service.ts` (planning) and `server/dashboard/currentRefreshRunner.ts` (fetch).

## Files

- `index.ts` — provider registry: `CURRENT_DATA_PROVIDERS` array + `providerFor(key)` lookup
- `weather-provider.ts` — weather current data
- `calendar-provider.ts` — calendar current data
- `deadlines-provider.ts` — deadlines (Todoist-backed) current data
- `bills-provider.ts` — bills/Actual current data + maintenance-refresh reason

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Related

- `server/dashboard/current-service.ts` — the engine that plans/schedules provider refreshes
- `server/dashboard/currentRefreshRunner.ts` — calls `provider.fetchFresh` behind the timeout race
