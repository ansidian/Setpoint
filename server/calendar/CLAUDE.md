# Server Calendar Map

Google Calendar integration: range reads, event mutations (including recurring scopes), push notifications, and the local search mirror. Entry point is `calendar.ts`; `calendar-push.ts` owns the notification/recovery worker consumed by `server/index.ts`.

## Files

- `calendar.ts` — public calendar entry module: range fetch, conflicts, Google wrappers, mirror reads, and route-facing range/search/write-effect re-exports
- `calendar-google-client.ts` — Google Calendar HTTP client: auth refresh, error translation
- `calendar-push.ts` — public push runtime: durable queue drain, serialized mirror/current-cache refresh, SSE, fifteen-minute recovery, watch renewal/discovery scheduling, and graceful shutdown
- `calendar-push-channels.ts` — programmatic event/calendar-list watches, hashed-token callback admission, atomic durable enqueue, overlapping renewal, and persisted watch/sync health
- `calendar-mutations.ts` — event CRUD incl. recurring scope (one/following/all), move, delete
- `calendar-event-write-effects.ts` — successful create/update/delete follow-through: search-mirror write-through or dirty marking plus best-effort reminder reconciliation
- `calendar-event-normalize.ts` — RRULE parse/serialize, display formatting, recurring-edit shaping (covered by `calendar-recurrence-roundtrip.test.ts`)
- `calendar-range-model.ts` — pure month-clamped ISO arithmetic plus calendar HTTP-range validation, parsed dates, span limits, and rolling-history overlap policy
- `calendar-search-service.ts` — calendar search use case: input policy, event/deadline and bill-mirror fanout, ranking envelope, and non-blocking mirror repair/refresh
- `calendar-search-mirror.ts` — public mirror surface: singleton sync scheduler, awaited provider-sync seam, local occurrence writes/reads, and health (thin orchestrator over the three modules below)
- `calendarSearchMirrorStatements.ts` — pure SQL builders for the search-mirror occurrence/state tables (upsert, tombstone, success)
- `calendarSearchMirrorHealthModel.ts` — pure per-source + aggregate mirror-health derivation
- `calendarSearchMirrorSync.ts` — full/incremental/repair sync engine + the -12/+18 month search-window projection (re-exports shared `addMonthsIso`)
- `calendar-search.ts` — ranks/normalizes event, deadline, and bill search candidates

Tests are not listed here; follow the behavior-ownership policy in `AGENTS.md`.

## Local patterns

- Pacific time (`America/Los_Angeles`) is the canonical display timezone.
- Calendar reuses the Gmail OAuth tokens; auth refresh lives in `calendar-google-client.ts`.
- Production registers HTTPS watches against the saved canonical origin; normal development never registers a production callback. Notifications are sync hints, and accepted work is durable before acknowledgement. Channel credentials are random tokens whose stored hashes do not require encryption-key inventory entries.
- Frontend calendar hooks/models live in `src/hooks/calendar/`, UI in `src/components/calendar/` — see those maps.

## Related

- `server/routes/calendar.ts` — HTTP surface
- `FLOWS.md` — calendar search mirror flow
