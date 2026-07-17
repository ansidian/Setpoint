# Server Calendar Map

Google Calendar integration: range reads, event mutations (including recurring scopes), and the local search mirror. Entry point is `calendar.ts`; `calendar-search-mirror.ts` exposes the mirror-sync worker consumed by `server/index.ts`.

## Files

- `calendar.ts` — public calendar entry module: range fetch, conflicts, Google wrappers, mirror reads, and route-facing range/search re-exports
- `calendar-google-client.ts` — Google Calendar HTTP client: auth refresh, error translation
- `calendar-mutations.ts` — event CRUD incl. recurring scope (one/following/all), move, delete
- `calendar-event-normalize.ts` — RRULE parse/serialize, display formatting, recurring-edit shaping (covered by `calendar-recurrence-roundtrip.test.ts`)
- `calendar-range-model.ts` — pure month-clamped ISO arithmetic plus calendar HTTP-range validation, parsed dates, span limits, and rolling-history overlap policy
- `calendar-search-service.ts` — calendar search use case: input policy, event/deadline and bill-mirror fanout, ranking envelope, and non-blocking mirror repair/refresh
- `calendar-search-mirror.ts` — public mirror surface: singleton sync scheduler/worker + local occurrence writes/reads + health (thin orchestrator over the three modules below)
- `calendarSearchMirrorStatements.ts` — pure SQL builders for the search-mirror occurrence/state tables (upsert, tombstone, success)
- `calendarSearchMirrorHealthModel.ts` — pure per-source + aggregate mirror-health derivation
- `calendarSearchMirrorSync.ts` — full/incremental/repair sync engine + the -12/+18 month search-window projection (re-exports shared `addMonthsIso`)
- `calendar-search.ts` — ranks/normalizes event, deadline, and bill search candidates

Other tests are not listed; adjacent test files cover their same-named source by convention.

## Local patterns

- Pacific time (`America/Los_Angeles`) is the canonical display timezone.
- Calendar reuses the Gmail OAuth tokens; auth refresh lives in `calendar-google-client.ts`.
- Frontend calendar hooks/models live in `src/hooks/calendar/`, UI in `src/components/calendar/` — see those maps.

## Related

- `server/routes/calendar.ts` — HTTP surface
- `FLOWS.md` — calendar search mirror flow
