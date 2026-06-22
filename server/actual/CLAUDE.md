# Server Actual Map

Actual Budget engine integration: write paths, the forked SDK worker, and the local metadata cache. Entry point is `actual.js`; the bills domain drives this layer and owns invalidation fan-out on writes.

## Files

- `actual.js` — facade routing writes to lightweight/worker/SDK path by mode
- `actual-core.js` — in-process Actual SDK ops: session lifecycle (lock/cache singletons), metadata/bill reads, schedule + transaction writes; orchestrates over actualCoreModel.js
- `actualCoreModel.js` — pure derivation for the SDK path: schedule classification/matching, condition building, date helpers, and the metadata/upcoming-bill projections
- `actual-lightweight-writes.js` — fast CRDT-message writes without booting the SDK; thin orchestrator over the four seam modules below
- `scheduleMatchModel.js` — pure schedule fuzzy/exact match, dedup, and cross-type sign guard; consumes actual-amount-condition.js
- `actualCrdtWire.js` — pure protobuf sync-request encode + drift self-check for the lightweight write path
- `actualWriteDb.js` — SQLite/CRDT persistence primitives and resolver reads for the lightweight write path
- `actualSyncTransport.js` — HTTP login + sync POST + merkle windowing for the lightweight write path
- `actual-clock-lock.js` — shared mutex serializing the @actual-app/crdt process-global clock across the write and metadata-refresh paths
- `actual-worker.js` — forked worker process management: spawn, queue, health, timeouts
- `actual-worker-child.js` — worker-child entry serializing ops onto the SDK singleton
- `actual-local-metadata.js` — local budget cache facade + orchestrator over the three seam modules below
- `actualMetadataModel.js` — pure derivation: Actual date coercion, rule-condition normalization, schedule classification, and the metadata projection
- `actualMetadataCacheStore.js` — filesystem cache ops: locate the budget dir by sync id, prune zip backups, summarize disk usage
- `actualMetadataSync.js` — lightweight metadata sync engine: HTTP login/download, protobuf sync POST, and CRDT-message apply under the clock lock
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
