# Server Calendar Map

Google Calendar integration: range reads, event mutations (including recurring scopes), and the local search mirror. Entry point is `calendar.js`; `calendar-search-mirror.js` exposes the mirror-sync worker consumed by `server/index.js`.

## Files

- `calendar.js` — public calendar entry module: range fetch, conflicts, Google wrappers, mirror reads, and route-facing range/search re-exports
- `calendar-google-client.js` — Google Calendar HTTP client: auth refresh, error translation
- `calendar-mutations.js` — event CRUD incl. recurring scope (one/following/all), move, delete
- `calendar-event-normalize.js` — RRULE parse/serialize, display formatting, recurring-edit shaping (covered by `calendar-recurrence-roundtrip.test.js`)
- `calendar-range-model.js` — pure month-clamped ISO arithmetic plus calendar HTTP-range validation, parsed dates, span limits, and rolling-history overlap policy
- `calendar-search-service.js` — calendar search use case: input policy, event/deadline and bill-mirror fanout, ranking envelope, and non-blocking mirror repair/refresh
- `calendar-search-mirror.js` — public mirror surface: singleton sync scheduler/worker + local occurrence writes/reads + health (thin orchestrator over the three modules below)
- `calendarSearchMirrorStatements.js` — pure SQL builders for the search-mirror occurrence/state tables (upsert, tombstone, success)
- `calendarSearchMirrorHealthModel.js` — pure per-source + aggregate mirror-health derivation
- `calendarSearchMirrorSync.js` — full/incremental/repair sync engine + the -12/+18 month search-window projection (re-exports shared `addMonthsIso`)
- `calendar-search.js` — ranks/normalizes event, deadline, and bill search candidates

(Other tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Pacific time (`America/Los_Angeles`) is the canonical display timezone.
- Calendar reuses the Gmail OAuth tokens; auth refresh lives in `calendar-google-client.js`.
- Frontend calendar hooks/models live in `src/hooks/calendar/`, UI in `src/components/calendar/` — see those maps.

## Related

- `server/routes/calendar.js` — HTTP surface
- `FLOWS.md` — calendar search mirror flow
