# Operations

Setup and maintenance reference for the owner. Environment variables are documented in [`.env.example`](.env.example); runtime behavior lives in [ARCHITECTURE.md](ARCHITECTURE.md) and [FLOWS.md](FLOWS.md).

## Local development

Use Node.js 24.15 or later within Node 24, as specified in [package.json](package.json).

1. Run `npm install` and copy `.env.example` to `.env`.
2. Set `EA_ENCRYPTION_KEY` to a 256-bit key (64 hex characters or standard base64) and `EA_SETUP_TOKEN` to a random value of at least 32 characters. Generate independent values with `openssl rand -hex 32`.
3. Run `npm run dev` and open `http://localhost:5173`. Vite proxies `/api` to Express on port 3001.
4. On a fresh database, enter the setup token, confirm the canonical URL, create the owner password, and save the displayed recovery codes. Connect providers in Settings.

Development uses `server/db/ea.db`; Turso credentials are unnecessary unless explicitly opting in. The encryption key is required locally. Automatic email triage uses local rules outside production by default; select real AI or pause processing in Settings → Automation.

For the fictional frontend alone, run `npm run demo`. It needs no backend or credentials and resets mutations on refresh. To inspect the static artifact, run `npm run build:demo` then `npm run preview:demo`.

The demo build adds public social metadata through `vite.config.ts`; normal private builds retain the plain Setpoint title. The **Release production and demo** workflow publishes `dist-demo` to `https://ansidian.github.io/Setpoint/` after successful `master` push CI, using `VITE_EA_DEMO_BASE=/Setpoint/`. Local builds do not publish. See [automatic releases](deploy/AUTOMATIC-DEPLOYMENT.md) for the separate production and demo paths. Another static host can serve `dist-demo`; use its correct base path and update the canonical/image URL in the Vite metadata hook when changing the public demo URL.

## Production

The owner's live instance runs on Debian; see [Debian operations](deploy/OPERATIONS-LIVE.md)
and [automatic releases](deploy/AUTOMATIC-DEPLOYMENT.md). Successful `master` push
CI publishes the production image; the installed Debian deployment timer pulls
and activates verified releases. The retained Render instance is suspended and
must not resume against stale Turso data. Recovery targets Debian. The Render
instructions below describe an alternative fresh installation, not the owner's
recovery plan.

The [Render Blueprint](render.yaml) provisions an always-on Starter Node service and a persistent asset disk. Supply `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; Render generates `EA_ENCRYPTION_KEY` and `EA_SETUP_TOKEN`. The service builds with `npm ci && npm run build`, starts with `npm start`, and checks readiness at `/healthz`.

After deployment, retrieve the generated setup token from the service environment and claim the instance in the browser. The owner password must have at least 12 characters. Save the one-time recovery codes, then use Settings to connect providers. Provider credentials are not required to boot. Workers remain inactive until the owner claim succeeds.

Other hosts need the same bootstrap values, an always-running Node process, and persistent storage for uploaded Notes assets. Production defaults to Turso; the explicit SQLite adapter supports local production as described below. Database migrations run at server startup.

Back up **both the database and its exact `EA_ENCRYPTION_KEY`**. The app cannot recover that key, and the database alone cannot decrypt stored credentials. Back up uploaded Notes media separately from `EA_TLDRAW_ASSET_DIR` (Render: `/var/data/tldraw-assets`). Production Notes also requires a tldraw license configured in Settings → Connections.

Normal provider configuration lives in Settings. After connecting Actual, configure Financial providers in Settings → Finance: choose each utility’s existing schedule, funding/card endpoints for credit-card payments, and reusable receipt/refund destinations. Actual target names load automatically; unavailable targets show a readable status and retry instead of internal identifiers. Create profile appears for emails with a recognized financial event classification other than `other`. It seeds an unsaved, disabled provider draft with its sender and available context; select missing targets before saving. Migration 069 starts with no enabled profiles and does not adopt retired mappings or Utilities membership. Unmatched receipts/refunds wait for review; reminder and completed-payment notices are ignored. Review can also suggest an unsaved provider draft that starts disabled for explicit setup. Card profiles schedule the full statement balance on an explicitly supported due date, or the numeric payment amount/date from a scheduled-payment confirmation. Missing or conflicting statement facts stay in review. Minimum due, current balance and AutoPay enrollment alone cannot supply the scheduled amount. Optional host-managed credentials and startup/backfill timing switches remain documented in `.env.example`.

## Sign-in and recovery

Password or passkey login is the default. Settings → System can enable password-plus-passkey login. Security changes require recent password confirmation.

An offline recovery code replaces the password, clears passkeys, revokes sessions and API tokens, and displays replacement codes once. If normal sign-in and offline recovery are unavailable, the operator can reset passkeys against the intended database:

```bash
npm run auth:reset-passkeys -- --dry-run
npm run auth:reset-passkeys -- --confirm
```

This restores password-or-passkey mode and clears passkeys and browser sessions; it does not replace the password. Existing installations may retain the legacy `EA_USER_ID` / `EA_PASSWORD_HASH` pair. Fresh installations create owner identity in the browser. See [authentication flows](FLOWS.md#8-owner-sign-in-step-up-and-offline-recovery) for details.

## Optional Todoist OAuth

A personal token in Settings supports normal read/write behavior with periodic reconciliation. For OAuth and webhooks, expand **Settings → Connections → Todoist → Advanced OAuth and webhooks**, enter the developer app credentials, register the displayed callback and webhook URLs in Todoist, then connect with OAuth. Saving a personal token later returns to periodic delivery.

## Google Calendar push

Production automatically registers Calendar watches for calendar-enabled Google accounts using the existing OAuth grant and saved canonical HTTPS URL at `/api/calendar/push`. There is no Calendar Pub/Sub topic, subscription, new secret, or manual webhook registration to configure. Existing accounts with Calendar access normally need no new consent; an account whose authorization has expired still needs reconnecting in Settings → Connections.

The server checks watches hourly, renews them before expiry, and retries failed checks after five minutes. Calendar notifications queue durable synchronization before acknowledgement. A minute worker drains pending/retry work, and a fifteen-minute reconciliation catches missed notifications and downtime. Normal localhost development keeps periodic synchronization but never registers watches against the production URL. After a domain change, Setpoint replaces registrations using the new saved canonical origin; that HTTPS endpoint must reach the deployed server with a valid certificate.

Some Google-managed calendars, including holidays, are readable but do not support push. When Google explicitly reports `pushNotSupportedForRequestedResource`, Setpoint keeps that calendar in periodic synchronization, remembers the limitation for seven days, and excludes it from required push watches. This does not create a health warning or a five-minute registration retry loop. Other authorization, request, and service errors remain visible and retry normally.

Calendar cache refresh remains eligible after five minutes. The health indicator gives automatic recovery a one-hour window from the last successful data check; failed synchronization, expired/failed watches, reconnect requirements and browser connection failures remain visible. A working subscription by itself does not establish fresh calendar data.

## Turso semantic search verification

To exercise native vectors instead of local SQLite, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, then run:

```bash
npm run ai-search:embedding-status -- --adapter=turso
npm run ai-search:backfill -- --adapter=turso --limit=25
npm run dev:ai-search-turso
```

The backfill also needs `EA_USER_ID` and `OPENAI_API_KEY`. This development command disables the periodic embedding worker, so use bounded backfills to change coverage.

## Verification and diagnostics

Use [AGENTS.md](AGENTS.md#verification) for targeted checks and the required pre-push `npm run verify` gate. All available commands are in [package.json](package.json).

- `npm run financial-email:observe` reports financial-email coverage and event outcomes, separating expected manual review from active operational failures and retired historical state. Parser breakdowns include provider, template, parser version and disposition; counts retain the owner/time-window boundary.
- `npm run financial-provider:replay -- <sources.json>` replays the current deterministic registry with writes disabled. Input is an array of normalized `{ fromAddress, subject, body, emailDate? }` sources or `{ source }` fixtures (optional extracted attachment text is supported). Output identifies rows by position and includes parser provenance/dispositions only; it omits source bodies, identifiers and candidate facts. It opens no database, loads no credentials, calls no AI and never connects to Actual. Use complete private originals from gitignored storage; commit only sanitized fixtures. The old `transaction-import:equivalence` tool is retired.
- `npm run triage:preflight` checks triage rules; `npm run triage:eval` evaluates models. Real evaluations need the owner's `EA_USER_ID` to load model settings and are excluded from production AI usage analytics.
- `npm run actual -- <command>` is for ad-hoc inspection. Runtime integrations use the in-process Actual API.
- The Actual SDK runs in one persistent serialized worker. Production defaults to a 1024 MiB old-space ceiling (not reserved memory); `EA_ACTUAL_WORKER_MAX_OLD_SPACE_MB` overrides it. `EA_ACTUAL_WORKER_IDLE_SHUTDOWN_MS=0` keeps the worker warm; a positive value enables idle retirement. Missing caches bootstrap through the bounded downloader before SDK synchronization. The old `EA_ACTUAL_SDK_WRITE_FALLBACK` and `EA_ACTUAL_ALLOW_COLD_SDK_DOWNLOAD` switches are retired. Ordinary reads remain local, finance maintenance runs every five minutes with one-minute failed-sync backoff, and health becomes stale after 15 minutes without a successful check. Successful writes publish immediately with a durable reconciliation fallback. Connection changes close the old SDK session; graceful app shutdown drains the worker.


## Acknowledge historical Gmail sync failures

Use this only after reviewing exact terminal failures and accepting any remaining historical uncertainty. Acknowledgment clears those jobs from current health; it does not claim their mailbox changes were recovered. Errors, payloads, attempts and original timestamps remain saved. New failures remain visible. No provider calls or mail changes occur.

Set `EA_USER_ID` to the owner and select the intended database as described above. Migration `079_email_history_acknowledgment.sql` must be applied before acknowledgment. Preview first:

```bash
NODE_ENV=production npm run email:acknowledge-history -- --job-ids 123,456 --reason "Reviewed historical failures; completeness remains unknown"
```

Review the account identities and errors, then repeat the exact IDs/reason with `--apply --expect <revision>` using the returned fingerprint. Any changed job rejects the entire selection; rerun the preview. Repeating an already-applied identical acknowledgment preserves its original metadata. A different reason cannot overwrite it. The command defaults to a read-only preview; it never selects every failure implicitly.

This repair does not require a restart: the existing health query excludes `acknowledged`. The dashboard reflects it on its next health read. Apply the additive migration through the normal migration runner so the migration ledger stays consistent; never mark historical failures `complete` merely to clear the indicator.

## Provider parser activation

Migrations 080–082 prepare inert schema. Deploy the verified runtime before activating. Known companies have dedicated modules in `server/financial-parsers/`; add grounded, sanitized fixtures and register a module there to extend coverage. Configuration controls authority independently of recognition. Unknown or unsupported templates require review.

1. Against the intended database, run `EA_USER_ID=<owner> node server/scripts/migrate-financial-connections.ts` for a read-only inventory and fingerprint. It merges existing profiles, utility identities and pay links without changing history or Actual.
2. Review the inventory, then repeat with `--apply --fingerprint <exact fingerprint>`. Concurrent legacy changes reject the migration. IDs, target permissions and utility history survive; the verified Citi statement sender alias and matching merchant label are explicitly corrected. Thereafter the unified revision/budget-bound API owns edits; retired legacy Settings and utility-mapping routes return HTTP 410.
3. Stop financial workers, verify no pending owner-confirmed work or active leases, then run `EA_USER_ID=<owner> node server/scripts/activate-financial-provider-parsers.ts --revision <migrated revision>`. Resume the verified runtime. Activation is one-way: never move this timestamp to replay history.
4. Observe only newly received and first-indexed mail. Historical emails are a write-disabled test corpus. Already attempted operations recover their immutable payload; historical unattempted automatic jobs cannot acquire new write authority.

Fresh installations and unmigrated development databases use the same explicit preview/apply steps after connecting Actual; an empty configuration becomes canonical without enabling any providers. Runtime reads retain legacy compatibility only until migration (including older offline schema snapshots). Do not delete archived input columns or utility rows, and do not use the retired writers to initialize setup.

For the disposable Actual lab, use its sanitized `lab/run.mjs` launcher. An inherited production environment takes precedence over `--env-file`; never use that flag alone to isolate an Actual write test. Verify both saved and process Actual URLs point to `127.0.0.1:5007` and that the budget ID is the clone before running acceptance.


## Debian self-hosted deployment

Domains and addresses below are public examples; use the private server runbook
for the owner's real endpoints. Keep deployment-specific values outside Git.

The private self-hosted copy supports `EA_DB_ADAPTER=sqlite` with an absolute
`EA_SQLITE_PATH`. It uses the existing local libSQL engine without cloud sync or
Turso credentials. Keep `NODE_ENV=production` and the exact production root key.
Default development and hosted-production behavior are unchanged.

`EA_WEBHOOK_ORIGIN` separates public Gmail/Calendar/Todoist delivery from the
canonical browser origin. Debian uses `https://setpoint.example.com` privately and
`https://server.example-tailnet.ts.net:8443` publicly for webhook POSTs only.
Keep Google/Todoist OAuth redirect registrations and passkey origins unchanged.
`EA_BIND_HOST` explicitly controls listening; the deployment binds loopback.

`EA_BACKGROUND_WORKERS_ENABLED=0` blocks startup and later owner-activation
workers. It does not disable provider-capable HTTP routes: rehearsals require
network isolation as well. Invalid enablement values fail startup.

Deployment, ingress tests and certificate renewal: see [deploy/README.md](deploy/README.md).
The current deployment, update commands, backup restoration, and recovery policy
are recorded in [deploy/OPERATIONS-LIVE.md](deploy/OPERATIONS-LIVE.md).
Debian is the recovery target; the retired Render deployment must remain inactive.

Actual Budget is also hosted on Debian, at `https://actual.example.com` over
Tailscale. The migration preserved the domain, password and budget/sync IDs, so
it does not require reconnecting Setpoint or resetting Actual sync. Development
machines using this production connection need Tailscale access. Setpoint's
`/srv/setpoint/data/actual` is a rebuildable SDK cache; the authoritative Actual
server data is `/srv/actual/data` and has its own encrypted backup schedule.
The apps share the private Nginx and certificate infrastructure. See
[Actual Budget on the same host](deploy/OPERATIONS-LIVE.md#actual-budget-on-the-same-host)
before proxy maintenance, recovery or moving Setpoint to another host.

`npm run db:local -- audit` checks a local database's integrity, foreign keys,
counts, native vectors, credential decryptability and referenced Notes media.
`npm run db:local -- snapshot /absolute/new.db` creates and checks a standalone
SQLite snapshot using VACUUM INTO, including committed WAL data. It refuses
an existing destination and never imports application startup/provider workers.
Both commands require explicit local database configuration.

Daily encrypted backups use `deploy/backup.sh` and its systemd timer. They copy
the main database consistently, then immutable Notes media, deployment config,
root key and certificate/DNS credentials into an age-encrypted archive. Actual
cache is reconstructed from its authoritative server. These Setpoint archives
do not include `/srv/actual/data`; recover Actual from its separate backups before
rehydrating Setpoint after loss of the Debian host. Seven Setpoint server archives
are retained; this Mac pulls and verifies archives hourly on the LAN, retaining 30.
The age private identity stays on the Mac outside Git; preserve it separately
in the owner's password manager for recovery if the Mac is lost. A ciphertext
archive without that identity cannot be restored.

Restore into a new private directory: decrypt with `age -d -i IDENTITY`, extract
the archive, provide its exact root key privately and audit the restored DB with
network disabled. Never overwrite the active data directory during a rehearsal.
Recovery targets Debian using its current data or a verified encrypted backup,
not the retired Render deployment or stale Turso copy. Retained cloud resources
are not a required recovery dependency; their deletion is a separate operation.
