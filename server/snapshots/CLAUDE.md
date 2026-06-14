# Server Snapshots Map

The briefing snapshot lifecycle: building snapshots, item lanes, snooze, and arrival grace. This is the product's "briefing" feature proper. Entry point is `snapshot-service.js`; `snooze-waker.js` exposes the waker worker consumed by `server/index.js`.

## Files

- `snapshot-service.js` — snapshot CRUD: build, fetch, triage attach, archive
- `snapshot-lifecycle.js` — normalizes lifecycle state transitions
- `snapshot-state-machine.js` — canonical snapshot state enum and transition rules
- `snapshot-snooze-lifecycle.js` — snooze end conditions and due-fire decisions
- `snapshot-item-mutations.js` — per-item mutations: read, archived, triaged
- `snapshot-triage-attachment.js` — attaches triage context (subject, bill candidate) to items
- `snapshot-test-fixtures.js` — snapshot test data generators
- `snooze-waker.js` — wakes due snoozes, reattaches arrival-grace emails
- `arrival-grace.js` — arrival grace window before new email is triaged

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- All lifecycle transitions go through `snapshot-state-machine.js`; do not hand-roll state strings.
- Triage decisions land on snapshot items via `snapshot-triage-attachment.js`; the triage worker itself lives with the triage domain.

## Related

- `server/routes/briefing/snapshot.js` — HTTP surface
- `server/scheduler.js` — cron boundary advance (`advanceSnapshotBoundary`)
- `FLOWS.md` — snapshot lifecycle and snooze flows, hop by hop
