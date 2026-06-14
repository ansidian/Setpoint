# Server Actual Map

Actual Budget engine integration: write paths, the forked SDK worker, and the local metadata cache. Entry point is `actual.js`; the bills domain drives this layer and owns invalidation fan-out on writes.

## Files

- `actual.js` — facade routing writes to lightweight/worker/SDK path by mode
- `actual-core.js` — in-process Actual SDK ops: metadata, bills, transactions, session lifecycle
- `actual-lightweight-writes.js` — fast CRDT-message writes without booting the SDK
- `actual-clock-lock.js` — shared mutex serializing the @actual-app/crdt process-global clock across the write and metadata-refresh paths
- `actual-worker.js` — forked worker process management: spawn, queue, health, timeouts
- `actual-worker-child.js` — worker-child entry serializing ops onto the SDK singleton
- `actual-local-metadata.js` — local budget cache: download, sync, prune, inspect
- `actual-metadata-projection.js` — DB projection of Actual metadata with TTL for fast reads
- `actual-bill-occurrences.js` — expands Actual schedules into dated bill occurrences with paid status
- `actual-amount-condition.js` — single source of truth for interpreting an Actual `amount` schedule condition (scalar cents vs `isbetween` range)
- `actual-connection-test.js` — HTTP-level reachability test for the Actual server
- `actual-transactions-read.js` — low-level on-disk transaction reader: queries `db.sqlite` directly via `@libsql/client` without booting the SDK

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Runtime paths must use the in-process `@actual-app/api` singleton via `actual.js`; the `npm run actual` CLI is for ad-hoc debugging only.
- `actual-worker.js` forks `actual-worker-child.js` by CWD-relative path; keep both files in this directory.

## Related

- `server/bills/bills-service.js` — drives writes and owns Actual-metadata invalidation fan-out
- `src/lib/actualMetadata.js` — frontend cache mirroring this metadata
