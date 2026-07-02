# Server Email Map

Email domain: multi-account fetch (Gmail API, iCloud IMAP), the local index, and incremental sync. Entry point is `email-service.js`; `email-backfill-worker.js` and `gmail-sync.js` expose the workers consumed by `server/index.js` and `server/scheduler.js`. The AI search pipeline lives in `search/` (see its map).

## Files

- `email-service.js` — public email API: search, fetch, read/trash mutations, backfill
- `pinned-emails.js` — pin-state overlay store: pin/unpin upserts + hydrated pinned-entry loads (index/triage merge, email_snapshot fallback)
- `email-fetch.js` — cross-account email fetching for Gmail and iCloud
- `email-provider-adapters.js` — per-account adapters: fetch, mark-read, trash
- `email-index.js` — parses headers, truncates bodies, writes `ea_email_index`
- `email-backfill-worker.js` — paginated backward-in-time index backfill worker
- `email-date.js` — email date header → ISO UTC
- `email-ai-models.js` — email AI model catalog with defaults and provider inference
- `gmail.js` — Gmail API client: list, fetch, search, mutate
- `gmail-sync.js` — Gmail history/push-driven incremental sync (covered by `gmail-callback.test.js` too)
- `gmailPubSubNotification.js` — pure Pub/Sub notification decode: base64url JSON → emailAddress/historyId payload
- `gmailHistoryProjection.js` — pure history-record projections: inbox/unread id-sets, provider-removal events, provider state from metadata
- `gmailTriageStatements.js` — pure triage statement builder: (user, account, email) → triage-row + triage-job INSERT pair (owns the arrival-grace branch)
- `gmailSyncClient.js` — raw Gmail HTTP: history.list paging, message metadata, profile historyId, watch-registration POST
- `gmailWatchStore.js` — `ea_gmail_watch_state` persistence: watch-state upsert, stored-cursor read, watch-error write, cursor statement builders (seed/advance/touch)
- `gmailReconciliation.js` — Gmail row reconciliation: resolve mailbox account ids, find existing rows, reconcile read-state + provider-removal against the index/snapshots
- `icloud.js` — iCloud Mail (IMAP) client
- `html-to-text.js` — HTML → text conversion for email bodies
- `dev-service.js` — dev/test helper: re-index recent emails
- `test-utils/email-index-db.js` — in-memory email index DB for tests

(Other tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- All index writes go through `email-index.js`; provider clients never write `ea_email_index` directly.
- Provider differences are absorbed in `email-provider-adapters.js`; consumers see one account-shaped interface.

## Related

- `server/email/search/` — AI search pipeline over the index (see its map)
- `server/routes/briefing/email.js`, `server/routes/accounts.js`, `server/routes/gmail-push.js` — HTTP surfaces
- `FLOWS.md` — Gmail push → sync → triage flow, hop by hop
