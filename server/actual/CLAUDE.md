# Server Actual Map

Actual Budget engine integration: write paths, the forked SDK worker, and the local metadata cache. Entry point is `actual.ts`; the bills domain drives this layer and owns invalidation fan-out on writes.

## Files

- `actual.ts` — facade routing writes to lightweight/worker/SDK path by mode
- `actual-core.ts` — in-process Actual SDK ops: session lifecycle (lock/cache singletons), metadata/bill reads, schedule + transaction writes; loads only an existing or bounded-validator-hydrated local budget and orchestrates over actualCoreModel.ts
- `actualCoreModel.ts` — pure derivation for the SDK path: schedule classification/matching, condition building, date helpers, and the metadata/upcoming-bill projections
- `actual-lightweight-writes.ts` — fast CRDT-message writes without booting the SDK; thin orchestrator over the four seam modules below
- `actualWriteModel.ts` — pure strict write-date validation and CRDT sync-cursor selection
- `scheduleMatchModel.ts` — pure schedule fuzzy/exact match, dedup, and cross-type sign guard; consumes actual-amount-condition.ts
- `actualCrdtWire.ts` — pure protobuf sync-request encode + drift self-check for the lightweight write path
- `actualWriteDb.ts` — SQLite/CRDT persistence primitives and resolver reads for the lightweight write path
- `actualSyncTransport.ts` — HTTP login + sync POST + merkle windowing for the lightweight write path
- `actual-clock-lock.ts` — shared mutex serializing the @actual-app/crdt process-global clock across the write and metadata-refresh paths
- `actual-worker.ts` — forked worker process management: spawn, queue, health, timeouts
- `actual-worker-protocol.ts` — shared discriminated request/response protocol and runtime parsing for parent/child worker messages
- `actual-worker-child.ts` — worker-child entry serializing ops onto the SDK singleton
- `actual-local-metadata.ts` — local budget cache facade + orchestrator over the three seam modules below
- `actualMetadataModel.ts` — pure derivation: Actual date coercion, rule-condition normalization, schedule classification, and the metadata projection
- `actualMetadataCacheStore.ts` — filesystem cache ops: locate the budget dir by sync id, prune zip backups, summarize disk usage
- `actualMetadataSync.ts` — lightweight metadata sync engine: HTTP login/download, protobuf sync POST, and CRDT-message apply under the clock lock
- `actual-budget-archive.ts` — hostile-archive boundary for lightweight downloads: compressed/expanded size, entry-count, structure, encryption, compression-method, and path-safe budget-ID checks before `adm-zip` parsing or filesystem writes
- `actual-metadata-projection.ts` — DB projection of Actual metadata with TTL for fast reads
- `actual-bill-occurrences.ts` — expands Actual schedules into dated bill occurrences with paid status
- `actual-amount-condition.ts` — single source of truth for interpreting an Actual `amount` schedule condition (scalar cents vs `isbetween` range)
- `actual-connection-test.ts` — HTTP-level reachability test for the Actual server
- `actual-connection-settings.ts` — verify-before-swap persistence for Actual connection candidates
- `actual-transactions-read.ts` — low-level on-disk transaction reader: queries `db.sqlite` directly via `@libsql/client` without booting the SDK

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- Runtime paths must use the in-process `@actual-app/api` singleton via `actual.ts`; the `npm run actual` CLI is for ad-hoc debugging only.
- `actual-worker.ts` forks `actual-worker-child.ts` by CWD-relative path; keep both files in this directory.

## Related

- `server/bills/bills-service.ts` — drives writes and owns Actual-metadata invalidation fan-out
- `src/lib/actualMetadata.ts` — frontend cache mirroring this metadata
