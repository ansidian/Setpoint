# Server Dashboard Current-Providers Map

Per-source modules for the `/api/dashboard/current` engine. Each provider owns its own fetch, change-publish, backoff, and maintenance behavior behind a uniform interface (`key`, `fetchFresh`, `onRefreshed`, and the optional refresh-reason hooks). The registry in `index.js` is consumed by `server/dashboard/current-service.js` (planning) and `server/dashboard/currentRefreshRunner.js` (fetch).

## Files

- `index.js` — provider registry: `CURRENT_DATA_PROVIDERS` array + `providerFor(key)` lookup
- `weather-provider.js` — weather current data
- `calendar-provider.js` — calendar current data
- `deadlines-provider.js` — deadlines (Todoist-backed) current data
- `bills-provider.js` — bills/Actual current data + maintenance-refresh reason

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Related

- `server/dashboard/current-service.js` — the engine that plans/schedules provider refreshes
- `server/dashboard/currentRefreshRunner.js` — calls `provider.fetchFresh` behind the timeout race
