# Server Email Map

Email domain: multi-account fetch (Gmail API, iCloud IMAP), the local index, and incremental sync. Entry point is `email-service.ts`; `email-backfill-worker.ts` and `gmail-sync.ts` expose the workers consumed by `server/index.ts` and `server/scheduler.ts`. The AI search pipeline lives in `search/` (see its map).

## Files

- `email-service.ts` — public email API: search, fetch, read/trash mutations, backfill
- `email-index-search.ts` — indexed-search query, ranking, pagination, and result projection behind the `email-service.ts` facade
- `pinned-emails.ts` — pin-state overlay store: pin/unpin upserts + hydrated pinned-entry loads (index/triage merge, email_snapshot fallback)
- `remote-content-trust.ts` — public owner-scoped persistence API for exact sender + receiving-account remote-content trust
- `email-fetch.ts` — cross-account email fetching for Gmail and iCloud
- `email-provider-adapters.ts` — per-account adapters: fetch, mark-read, trash
- `email-provider-types.ts` — provider/account normalization contracts and adapter boundary types
- `email-mime-attachments.ts` — shared MIME attachment descriptor and bounded byte-selection helpers
- `email-index.ts` — parses headers, truncates bodies, writes `ea_email_index`
- `sender-authentication.ts` — provider-neutral, redacted sender-authentication projection; trusts Gmail's leading `mx.google.com` result and iCloud's anchored Apple delivery/authentication block; unknown or ambiguous iCloud layouts remain unavailable
- `verification-code-detector.ts` — pure conservative verification-code extraction from normalized subject/snippet/body context; returns one exact bounded token or null
- `email-persistence-types.ts` — local index/pin database client and raw-row contracts
- `email-backfill-worker.ts` — paginated backward-in-time index backfill worker
- `email-date.ts` — email date header → ISO UTC
- `email-ai-models.ts` — email-triage defaults, provider inference, and validation facade over the centralized AI model catalog
- `gmail.ts` — Gmail message API client: list, fetch, search, and mutate; re-exports the credential entry points
- `gmail-credentials.ts` — Gmail credential lifecycle: OAuth callback exchange/profile validation/canonical persistence plus access-token refresh, encryption, and reauth signaling
- `transaction-email-search.ts` — documented cross-domain entry for allowlisted, bounded all-mail transaction discovery
- `gmail-oauth-url.ts` — combined Gmail + Calendar scope set and canonical Google authorization-URL construction
- `gmail-sync.ts` — Gmail history/push-driven incremental sync and durable settlement; re-exports watch lifecycle entry points
- `gmail-watch-lifecycle.ts` — Gmail watch registration/renewal lifecycle: due selection, topic resolution, persistence, and per-account failure isolation
- `gmail-pubsub.ts` — hashed push-token lifecycle, runtime topic/status projection, callback generation, and explicit watch tests
- `email-sync-types.ts` — local history, Pub/Sub, watch, provider-state, and sync error contracts
- `gmailPubSubNotification.ts` — pure Pub/Sub notification decode: base64url JSON → emailAddress/historyId payload
- `gmailHistoryProjection.ts` — pure history-record projections: inbox/unread id-sets, provider-removal events, provider state from metadata
- `gmailTriageStatements.ts` — pure triage statement builder: (user, account, email) → triage-row + triage-job INSERT pair (owns the arrival-grace branch)
- `gmailSyncClient.ts` — raw Gmail HTTP: history.list paging, message metadata, profile historyId, watch-registration POST
- `gmailWatchStore.ts` — `ea_gmail_watch_state` persistence: watch-state upsert, stored-cursor read, watch-error write, cursor statement builders (seed/advance/touch)
- `gmailReconciliation.ts` — Gmail row reconciliation: resolve mailbox account ids, find existing rows, reconcile read-state + provider-removal against the index/snapshots
- `email-arrival-timing.ts` — pure projection of provider, durable queue, sync, and snapshot-attachment timing stages
- `icloud.ts` — iCloud Mail (IMAP) client
- `html-to-text.ts` — HTML → text conversion for email bodies
- `mime-artifacts.ts` — heuristic detector for raw-MIME body_text rows (reindex targeting)
- `mailparser.d.ts` — owned declaration shim for the untyped `mailparser` package boundary
- `dev-service.ts` — dev/test helper: re-index recent emails
- `test-utils/email-index-db.ts` — in-memory email index DB for tests

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- All index writes go through `email-index.ts`; provider clients never write `ea_email_index` directly.
- Verification-code detection runs locally in that shared index path; it never calls a provider/model and persists no surrounding evidence.
- Provider differences are absorbed in `email-provider-adapters.ts`; consumers see one account-shaped interface.

## Related

- `server/email/search/` — AI search pipeline over the index (see its map)
- `server/routes/briefing/email.ts`, `server/routes/accounts.ts`, `server/routes/gmail-push.ts` — HTTP surfaces
- `FLOWS.md` — Gmail push → sync → triage flow, hop by hop
