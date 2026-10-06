# Operations

Setup and maintenance reference for the owner. Environment variables are documented in [`.env.example`](.env.example); runtime behavior lives in [ARCHITECTURE.md](ARCHITECTURE.md) and [FLOWS.md](FLOWS.md).

## Local development

Use Node.js 24.15 or later within Node 24, as specified in [package.json](package.json).

1. Run `npm install` and copy `.env.example` to `.env`.
2. Set `EA_ENCRYPTION_KEY` to a 256-bit key (64 hex characters or standard base64) and `EA_SETUP_TOKEN` to a random value of at least 32 characters. Generate independent values with `openssl rand -hex 32`.
3. Run `npm run dev` and open `http://localhost:5173`. Vite proxies `/api` to Express on port 3001.
4. On a fresh database, enter the setup token, confirm the canonical URL, create the owner password, and save the displayed recovery codes. Connect providers in Settings.

Development uses the local SQLite file `server/db/ea.db`. The encryption key is required locally. Automatic email triage uses local rules outside production by default; select real AI or pause processing in Settings → Automation.

For the fictional frontend alone, run `npm run demo`. It needs no backend or credentials and resets mutations on refresh. To inspect the static artifact, run `npm run build:demo` then `npm run preview:demo`.

The demo build adds public social metadata through `vite.config.ts`; normal private builds retain the plain Setpoint title. The **Release production and demo** workflow publishes `dist-demo` to `https://ansidian.github.io/Setpoint/` after successful `master` push CI, using `VITE_EA_DEMO_BASE=/Setpoint/`. Local builds do not publish. See [automatic releases](deploy/AUTOMATIC-DEPLOYMENT.md) for the separate production and demo paths. Another static host can serve `dist-demo`; use its correct base path and update the canonical/image URL in the Vite metadata hook when changing the public demo URL.

## Production

The owner's live instance runs in Docker on a Debian home server. Its application
database is a persistent local SQLite file at the absolute `EA_SQLITE_PATH`; SQLite
is the only supported database, and production refuses to start without that path.
See [Debian operations](deploy/OPERATIONS-LIVE.md) for live access and recovery and
[automatic releases](deploy/AUTOMATIC-DEPLOYMENT.md) for deployment. Successful
`master` push CI publishes the production image; the installed Debian deployment
timer pulls and activates verified releases. Use the Debian database for current
diagnosis and repair.

Back up **both the database and its exact `EA_ENCRYPTION_KEY`**. The app cannot recover that key, and the database alone cannot decrypt stored credentials. Back up uploaded Notes media separately from `EA_TLDRAW_ASSET_DIR`. Production Notes also requires a tldraw license configured in Settings → Connections. Database migrations run at server startup. Migration 085 irreversibly drops the former finance tables, `ea_api_tokens` and finance columns; back up the database (and keep that backup) before deploying it — see [Debian operations](deploy/OPERATIONS-LIVE.md#development-and-releases).

Normal provider configuration lives in Settings. Settings → Connections → Actual Budget takes the server URL, server password and sync ID, plus an optional **Encryption password** for end-to-end encrypted budgets. Save and Check verify it against the budget's key test; it is stored encrypted, included in root-key rotation, and never sent to the Actual server. Finances is read-only: Setpoint never writes to Actual, and transaction import and bill updates are handled outside Setpoint. Optional host-managed credentials and startup/backfill timing switches remain documented in `.env.example`.

### Fresh installations

A new host needs an always-running Node process (or the production Docker image),
`NODE_ENV=production`, an absolute persistent `EA_SQLITE_PATH`, a new
`EA_ENCRYPTION_KEY` and `EA_SETUP_TOKEN`, and persistent storage for Notes assets
(`EA_TLDRAW_ASSET_DIR`). The server builds with `npm ci && npm run build`, starts
with `npm start`, and reports readiness at `/healthz`. To replace the owner's live
instance, follow the Debian recovery runbook with current data instead.

After starting a fresh instance, claim it in the browser with the setup token. The
owner password must have at least 12 characters. Save the one-time recovery codes,
then use Settings to connect providers. Provider credentials are not required to
boot; workers remain inactive until the owner claim succeeds.

## Sign-in and recovery

Password or passkey login is the default. Settings → System can enable password-plus-passkey login. Security changes require recent password confirmation.

An offline recovery code replaces the password, clears passkeys, revokes sessions, and displays replacement codes once. If normal sign-in and offline recovery are unavailable, the operator can reset passkeys against the intended database:

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

## Semantic search coverage

Report and extend email embedding coverage against the configured SQLite database:

```bash
npm run ai-search:embedding-status
npm run ai-search:backfill -- --limit=25
```

Both need `EA_USER_ID`; the backfill also needs `OPENAI_API_KEY` and always requires a bounded `--limit`. Production startup verifies native vector support in the SQLite engine.

## Verification and diagnostics

Use [AGENTS.md](AGENTS.md#verification) for targeted checks and the required pre-push `npm run verify` gate. All available commands are in [package.json](package.json).

- `npm run triage:preflight` checks triage rules; `npm run triage:eval` evaluates models. Real evaluations need the owner's `EA_USER_ID` to load model settings and are excluded from production AI usage analytics.
- `npm run actual -- <command>` is for ad-hoc inspection. Runtime integrations use the in-process Actual API.
- The Actual SDK runs in one persistent serialized worker. Production defaults to a 1024 MiB old-space ceiling (not reserved memory); `EA_ACTUAL_WORKER_MAX_OLD_SPACE_MB` overrides it. `EA_ACTUAL_WORKER_IDLE_SHUTDOWN_MS=0` keeps the worker warm; a positive value enables idle retirement. The worker loads the budget with the SDK's `downloadBudget` (supplying the encryption password when configured); a local copy that can no longer decrypt is replaced once with a fresh download. Ordinary reads use the local copy, and the bills mirror refreshes every five minutes with one-minute failed-sync backoff. Setpoint performs no Actual writes. Connection changes close the old SDK session; graceful app shutdown drains the worker.


## Gmail outbound notification delivery

Set `GMAIL_PUBSUB_SUBSCRIPTION=projects/example-project/subscriptions/gmail-pull`
to enable the Google Pub/Sub StreamingPull worker. Keep `GMAIL_PUBSUB_TOPIC`
(or its saved Settings value) set to the topic that Gmail watches publish to.
The subscription must be a **pull** subscription on that same topic. Leaving
this environment variable unset preserves the existing HTTPS push deployment.

Authenticate with Google Application Default Credentials. For an external host,
use a dedicated service account with `roles/pubsub.subscriber` granted on only
that subscription. Mount its private JSON credential read-only into the app and
set `GOOGLE_APPLICATION_CREDENTIALS` to the container path. Never bake credentials
into the image, copy them into this repository, or reuse an administrator login.
An example app Compose addition (adapt host paths before applying):

```yaml
services:
  app:
    volumes:
      - /srv/setpoint/secrets/gmail-subscriber.json:/run/secrets/gmail-subscriber.json:ro
```

Set `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gmail-subscriber.json` in the
private runtime environment. The file must be readable by the container's app
UID, with restrictive host permissions. This is a deliberate host configuration
change; publishing an application image does not install mounts or credentials.

For an existing push subscription, save its complete private configuration and
IAM policy first, deploy the worker, and coordinate clearing only its pushConfig
with enabling pull mode. Reuse the subscription to retain unacknowledged messages;
do not delete/recreate it. Preserve topic, retention and all unrelated settings.
The subscriber cannot change Google subscription settings. Rollback disables
pull mode and restores the saved pushConfig; retain current application data.

Settings → Gmail real-time delivery reports waiting for first delivery, active,
or retrying. Active means a notification was durably admitted in this process;
a quiet inbox is not a failure. Registration tests alone do not establish actual
delivery. Confirm receive/ack metrics, backlog and durable history-job completion
after cutover. Queue admission is idempotent; failed writes are not acknowledged.
The worker starts only with owner background workers enabled, stays off during
migration rehearsal, and drains admission before scheduler shutdown.

Calendar and Todoist use separate HTTPS callbacks and are unaffected. Calendar
retains its existing 15-minute recovery reconciliation. Keep Funnel and its
restricted proxy if those callbacks still use it; label their health alerts
separately from Gmail. Gmail's ten-minute inbox fallback remains enabled.

## Acknowledge historical Gmail sync failures

Use this only after reviewing exact terminal failures and accepting any remaining historical uncertainty. Acknowledgment clears those jobs from current health; it does not claim their mailbox changes were recovered. Errors, payloads, attempts and original timestamps remain saved. New failures remain visible. No provider calls or mail changes occur.

Set `EA_USER_ID` to the owner and select the intended database as described above. Migration `079_email_history_acknowledgment.sql` must be applied before acknowledgment. Preview first:

```bash
NODE_ENV=production npm run email:acknowledge-history -- --job-ids 123,456 --reason "Reviewed historical failures; completeness remains unknown"
```

Review the account identities and errors, then repeat the exact IDs/reason with `--apply --expect <revision>` using the returned fingerprint. Any changed job rejects the entire selection; rerun the preview. Repeating an already-applied identical acknowledgment preserves its original metadata. A different reason cannot overwrite it. The command defaults to a read-only preview; it never selects every failure implicitly.

This repair does not require a restart: the existing health query excludes `acknowledged`. The dashboard reflects it on its next health read. Apply the additive migration through the normal migration runner so the migration ledger stays consistent; never mark historical failures `complete` merely to clear the indicator.

## Debian self-hosted deployment

Domains and addresses below are public examples; use the private server runbook
for the owner's real endpoints. Keep deployment-specific values outside Git.

The deployment uses an absolute `EA_SQLITE_PATH` on a persistent mount, the local
libSQL engine, `NODE_ENV=production` and the exact production root key.
`EA_DB_ADAPTER=sqlite` in the deployment files is accepted for compatibility; any
other value fails startup.

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
Debian is the recovery target.

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
Recovery targets Debian using its current data or a verified encrypted backup.
