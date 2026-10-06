# Server Actual Map

Read-only Actual Budget integration: the forked SDK worker that downloads and syncs the local budget copy, disk readers over that copy, and the connection settings. Entry point is `actual.ts`. Nothing here writes to Actual.

## Files

- `actual.ts` — facade routing synchronization to the persistent SDK worker; exposes the SDK-free Journal read and metadata projection
- `actual-core.ts` — in-process SDK session: serialized lock, `downloadBudget` with the optional end-to-end encryption password, one-time replacement of a stale local copy after a key error, sync, and backup pruning
- `actual-worker.ts` — forked worker process management: persistent session, queue, timeouts, and awaited shutdown
- `actual-worker-protocol.ts` — shared discriminated request/response protocol and runtime parsing for parent/child worker messages
- `actual-worker-child.ts` — worker-child entry serializing ops onto the SDK singleton and draining it on SIGTERM/SIGINT
- `actual-local-metadata.ts` — the single stored-connection reader (including the encryption password) and disk-only budget readers; reads never download or synchronize
- `actualMetadataModel.ts` — pure derivation: Actual date coercion, rule-condition normalization, schedule classification with transfer-account projection, and the metadata projection
- `actualMetadataCacheStore.ts` — filesystem cache ops: locate the budget dir by sync id, prune zip backups, summarize disk usage
- `actual-metadata-projection.ts` — DB projection of Actual metadata for fast reads
- `actual-journal-read.ts` — bounded SDK-free Journal read with exact split/transfer relative hydration
- `actual-bill-occurrences.ts` — expands Actual schedules into dated occurrences with paid status
- `actual-amount-condition.ts` — single source of truth for interpreting an Actual `amount` schedule condition (scalar cents vs `isbetween` range)
- `actual-connection-test.ts` — HTTP reachability test for the Actual server, including the end-to-end encryption key test (PBKDF2-SHA512 + AES-256-GCM, matching Actual)
- `actual-connection-settings.ts` — verify-before-swap persistence for Actual connection candidates and the encrypted encryption password

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Runtime paths must use the in-process `@actual-app/api` singleton via `actual.ts`; the `npm run actual` CLI is for ad-hoc debugging only.
- The SDK worker alone downloads and synchronizes the local budget. Local SQL reads never hydrate or synchronize. Healthy workers remain loaded; connection changes close the old session.
- The encryption password only unlocks the budget in the SDK session; it is never sent to the Actual server.
- `actual-worker.ts` forks `actual-worker-child.ts` by CWD-relative path; keep both files in this directory.

## Related

- `server/bills/` — schedule mirror built from the synchronized budget
- `server/finances/` — the read-only Finances composition
