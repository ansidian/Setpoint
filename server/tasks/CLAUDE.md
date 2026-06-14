# Server Tasks Map

Todoist-backed tasks and deadlines: the REST/webhook/mirror sync stack plus deadline reads and reconciliation. Entry points are `tasks-service.js` (task mutations) and `deadlines-read.js` (deadline reads); `todoist-webhook.js` exposes the mirror-sync worker consumed by `server/index.js`.

## Files

- `tasks-service.js` — Todoist task complete/delete/projects/labels service wrappers
- `deadlines-read.js` — reads current/range deadlines: Todoist merge, tombstones, reminders
- `deadline-helpers.js` — task reconciliation: completed IDs, active filters, stats (covered by `carry-forward.test.js` and `completed-task-ids.test.js`)
- `todoist.js` — Todoist facade: fetch tasks, sync health
- `todoist-api.js` — Todoist REST client
- `todoist-mirror.js` — syncs tasks into the local Todoist mirror tables
- `todoist-webhook.js` — webhook delta processing
- `todoist-reminder-source.js` — exposes Todoist deadlines as reminder sources
- `todoist-token.js` — Todoist OAuth token storage/refresh
- `tombstones.js` — tombstones for completed recurring tasks (resurrection guard)

(Other tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Todoist data is mirrored locally; reads go through the mirror, not the live API.
- Tombstones guard completed recurring tasks against webhook resurrection.

## Related

- `server/routes/briefing/tasks.js` and `server/routes/todoist-webhook.js` — HTTP surfaces
- `server/reminders/` — consumes `todoist-reminder-source.js`
- `server/scheduler.js` — cron entry for mirror maintenance
