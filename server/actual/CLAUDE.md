# Server Actual Map

Actual Budget engine integration: write paths, the forked SDK worker, and the local metadata cache. Entry point is `actual.ts`; the bills domain drives this layer and owns invalidation fan-out on writes.

## Files

- `actual.ts` — facade routing writes to lightweight/worker/SDK path by mode; exposes SDK-free local transaction reads
- `actual-core.ts` — in-process Actual SDK ops: session lifecycle (lock/cache singletons), metadata/bill reads, transaction writes/imports, and orchestration over the schedule-write module; loads only an existing or bounded-validator-hydrated local budget
- `actualTransferSchedules.ts` — synced transfer schedule execution; managed events bind exact preview fingerprints before updating or reactivating compatible schedules, with explicit existing IDs selecting only that schedule even when accounts have other schedules; retained imports stay create-only; exact paired-transaction reconciliation, stable schedule IDs, tombstone checks, and recovery without writes
- `actualFinancialOperations.ts` — budget-bound expense/income import through the existing grouped importer, exact completed-transfer posting, and utility schedule create/update, including compatible completed prior cycles; preview binds the budget and existing schedule fingerprint, the durable event outbox admits one write, and recovery only verifies synced results, including payee and the preview-frozen optional category
- `actualSdkScheduleWrites.ts` — SDK schedule-write module over an injected Actual SDK port: schedule/rule hydration, payee/account resolution, bill/transfer matching and upsert, past-date posting, and one-off bill transaction projection
- `actualCoreModel.ts` — pure derivation for the SDK path: schedule classification/matching (including transfer-account projection), condition building, date helpers, and the metadata/upcoming-bill projections
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
- `actualMetadataModel.ts` — pure derivation: Actual date coercion, rule-condition normalization, schedule classification with transfer-account projection, and the metadata projection
- `actualMetadataCacheStore.ts` — filesystem cache ops: locate the budget dir by sync id, prune zip backups, summarize disk usage
- `actualMetadataSync.ts` — lightweight metadata sync engine: HTTP login/download, protobuf sync POST, and CRDT-message apply under the clock lock
- `actual-budget-archive.ts` — bounded native stored/deflate reader for lightweight downloads: validates compressed/expanded size, entry count, local/central structure, encryption, CRC, and path-safe budget IDs, and returns only `db.sqlite` plus `metadata.json`
- `actual-metadata-projection.ts` — DB projection of Actual metadata with TTL for fast reads
- `actual-bill-occurrences.ts` — expands Actual schedules into dated bill occurrences with paid status
- `actual-amount-condition.ts` — single source of truth for interpreting an Actual `amount` schedule condition (scalar cents vs `isbetween` range)
- `actual-write-coordination.ts` — parent-process write serialization and durable active/original-source correction guards
- `actualCorrectionEvidence.ts` — exact raw correction snapshots including orphan schedule children
- `actualCorrectionExecutor.ts` — one awaited frozen dispatch and synchronized effect verification
- `actualOriginalEvidence.ts` — read-only raw SDK transaction/schedule graph snapshots and original before/after evidence; preserves cents, exact IDs and unknown provenance
- `actualTransactionImportModel.ts` — pure validation, SDK projection, compatibility classification, and reconciliation outcome mapping for grouped imports
- `actual-connection-test.ts` — HTTP-level reachability test for the Actual server
- `actual-connection-settings.ts` — verify-before-swap persistence for Actual connection candidates
- `actual-transactions-read.ts` — low-level on-disk transaction reader: queries `db.sqlite` directly via `@libsql/client` without booting the SDK

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Runtime paths must use the in-process `@actual-app/api` singleton via `actual.ts`; the `npm run actual` CLI is for ad-hoc debugging only.
- Categories are optional across financial-event and retained bill writes. Unavailable category IDs are omitted; schedule updates preserve existing categories when no replacement is supplied.
- Transaction verification checks core identity before category. A rule-driven or later category-only mismatch retains the exact transaction ID and reports that it was recorded but needs category review; it never reports success, recreates the entry, or overwrites the Actual category. Actual's import preview does not expose the final category for new transactions, so this validation uses the synced readback.
- Read-only utility preview recognizes an exact existing base amount or the base plus its configured SCE/SoCalGas fee on the same account/payee/date. Competing matches require review. The fee is never added to a write, and immutable write/recovery verification remains exact.
- Managed utility and transfer updates preserve Actual's `is`/`isapprox` date-matching operator while verifying the requested schedule date exactly.
- Managed utility updates retain complex recurrence calendars and finite occurrence limits, using Actual's recurrence engine to verify and select an upcoming occurrence.
- `actual-worker.ts` forks `actual-worker-child.ts` by CWD-relative path; keep both files in this directory.

## Related

- `server/bills/bills-service.ts` — drives writes and owns Actual-metadata invalidation fan-out
- `src/lib/actualMetadata.ts` — frontend cache mirroring this metadata

- `actual-journal-read.ts` — bounded SDK-free Journal read with exact split/transfer relative hydration
