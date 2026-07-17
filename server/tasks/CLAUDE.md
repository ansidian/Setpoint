# Server Tasks Map

Todoist-backed tasks and deadlines: the REST/webhook/mirror sync stack plus deadline reads and reconciliation. Entry points are `tasks-service.ts` (task mutations) and `deadlines-read.ts` (deadline reads); `todoist-webhook.ts` exposes the mirror-sync worker consumed by `server/index.ts`.

## Files

- `tasks-service.ts` — Todoist task complete/delete/projects/labels service wrappers
- `deadlines-read.ts` — reads current/range deadlines: Todoist merge, tombstones, reminders
- `deadline-helpers.ts` — task reconciliation: active filters, stats (covered by `carry-forward.test.ts`)
- `todoist.ts` — Todoist facade: fetch tasks, sync health
- `todoist-api.ts` — Todoist REST client
- `todoist-mirror.ts` — syncs tasks into the local Todoist mirror tables (thin IO orchestrator over the two pure modules below)
- `todoistMirrorStatements.ts` — pure SQL statement-builders for the mirror tables and sync-state success/tombstone/reconcile writes
- `todoistMirrorHealthModel.ts` — pure derivation of mirror health (state/severity/ageMs) from sync-state freshness
- `todoist-webhook.ts` — webhook delta processing
- `todoist-reminder-source.ts` — exposes Todoist deadlines as reminder sources
- `todoist-token.ts` — Todoist OAuth token storage/refresh
- `tombstones.ts` — tombstones for completed recurring tasks (resurrection guard)

(Other tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- Todoist data is mirrored locally; reads go through the mirror, not the live API.
- Tombstones guard completed recurring tasks against webhook resurrection.
- Mirror sync reconciles `ea_completed_tasks`: a non-recurring occurrence the mirror reports active again (a Todoist reopen) drops its stale completion tombstone so `completeDeadlineOccurrence` re-closes it instead of short-circuiting. Recurring occurrences keep their tombstone (resurrection guard).

## Related

- `server/routes/briefing/tasks.ts` and `server/routes/todoist-webhook.ts` — HTTP surfaces
- `server/reminders/` — consumes `todoist-reminder-source.ts`
- `server/scheduler.ts` — cron entry for mirror maintenance
