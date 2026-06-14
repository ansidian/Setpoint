# Server Calendar Map

Google Calendar integration: range reads, event mutations (including recurring scopes), and the local search mirror. Entry point is `calendar.js`; `calendar-search-mirror.js` exposes the mirror-sync worker consumed by `server/index.js`.

## Files

- `calendar.js` — public calendar API: range fetch, conflicts, Google wrappers, mirror reads
- `calendar-google-client.js` — Google Calendar HTTP client: auth refresh, error translation
- `calendar-mutations.js` — event CRUD incl. recurring scope (one/following/all), move, delete
- `calendar-event-normalize.js` — RRULE parse/serialize, display formatting, recurring-edit shaping (covered by `calendar-recurrence-roundtrip.test.js`)
- `calendar-search-mirror.js` — full/incremental sync into `ea_calendar_search_occurrences`, health
- `calendar-search.js` — ranks/normalizes event, deadline, and bill search candidates

(Other tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Pacific time (`America/Los_Angeles`) is the canonical display timezone.
- Calendar reuses the Gmail OAuth tokens; auth refresh lives in `calendar-google-client.js`.
- Frontend calendar hooks/models live in `src/hooks/calendar/`, UI in `src/components/calendar/` — see those maps.

## Related

- `server/routes/calendar.js` — HTTP surface
- `FLOWS.md` — calendar search mirror flow
