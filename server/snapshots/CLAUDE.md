# Server Snapshots Map

The briefing snapshot lifecycle: building snapshots, item lanes, snooze, and arrival grace. This is the product's "briefing" feature proper. Entry point is `snapshot-service.ts`; `snooze-waker.ts` exposes the waker worker consumed by `server/index.js`.

## Files

- `snapshot-service.ts` — snapshot orchestration API: build, fetch, sync, triage attach, provider-removal; thin orchestrator over snapshotStore.ts + snapshotViewModel.ts
- `snapshot-types.ts` — local database, provider-like input, and error-boundary types shared within the snapshot backend
- `snapshotStore.ts` — snapshot persistence: ea_briefing_snapshots/_items reads + lifecycle writes (find/freeze/carryover), item loads, processing-state counts, history rows/counts
- `snapshotViewModel.ts` — pure view projection: shapes loaded items into the lane/filter/laneCount briefing view
- `snapshot-lifecycle.ts` — normalizes lifecycle state transitions
- `snapshot-state-machine.ts` — canonical snapshot state enum and transition rules
- `snapshot-snooze-lifecycle.ts` — snooze end conditions and due-fire decisions
- `snapshot-item-mutations.ts` — per-item mutations: read, archived, triaged
- `snapshot-triage-attachment.ts` — attaches triage context (subject, bill candidate) to items
- `snapshot-test-fixtures.ts` — snapshot test data generators
- `snooze-waker.ts` — wakes due snoozes, reattaches arrival-grace emails
- `arrival-grace.ts` — arrival grace window before new email is triaged

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- All lifecycle transitions go through `snapshot-state-machine.ts`; do not hand-roll state strings.
- Triage decisions land on snapshot items via `snapshot-triage-attachment.ts`; the triage worker itself lives with the triage domain.

## Related

- `server/routes/briefing/snapshot.ts` — HTTP surface
- `server/scheduler.ts` — cron boundary advance (`advanceSnapshotBoundary`)
- `FLOWS.md` — snapshot lifecycle and snooze flows, hop by hop
