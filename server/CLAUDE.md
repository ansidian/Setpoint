# Server Root Map

Composition root and cross-cutting server concerns that don't belong to a single domain. `server/<domain>/` subdirectories with their own `CLAUDE.md` (email, bills, calendar, snapshots, tasks, reminders, triage, actual, platform, routes, alfred, news, middleware, transactions) carry their own maps — see those for domain logic. This map covers everything else directly under `server/`, including the smaller subdirectories below that don't yet warrant their own map.

## Files

### Root
- `index.js` — Express app assembly; wires middleware, routes, and background workers; owns the HTTP server instance
- `scheduler.js` — cron composition root; starts/stops all background workers across domains
- `scheduler-work-registry.js` — shared admission/single-flight registry that lets scheduler shutdown await every admitted task
- `scheduler-email-triage-drain.js` — scheduler-owned earliest-deadline controller and request seam for durable email-triage jobs
- `shutdown.js` — generic, injectable graceful-shutdown sequencer (`createGracefulShutdown`); pure sequencing logic over an injected `server` + `stopFns` array, no knowledge of which workers it's draining
- `env.js` — required-env-var validation (dev vs. production)
- `security.js` — trust-proxy setting, Content-Security-Policy, security middleware
- `static-assets.js` — production frontend static-file serving and SPA fallback
- `startup-delays.js` — staggered startup delay/jitter calculation for background workers
- `timing.js` — request/phase timing log helpers
- `hash-password.js` — one-shot CLI to bcrypt-hash a password for `EA_PASSWORD_HASH`

### `auth/` — passkey/WebAuthn and session support
- `auth/passkey-store.js` — CRUD for stored passkey credentials
- `auth/pending-auth-store.js` — short-lived pending-auth token issuance/lookup (WebAuthn ceremony handoff)
- `auth/session-rotation.js` — bulk session revocation (e.g. on passkey changes), clears the auth validation cache
- `auth/webauthn-challenge-store.js` — short-lived WebAuthn challenge issuance/lookup
- `auth/webauthn-config.js` — relying-party (RP) id/name/origin resolution for dev vs. production
- `auth/webauthn-service.js` — registration/authentication option + verification flows (via `@simplewebauthn/server`)

### `db/` — connection and migrations
- `db/config.ts` — resolves the libsql client config (local file vs. remote URL/token) from env
- `db/connection.ts` — the shared libsql client instance (default export)
- `db/migrate.ts` — runs the SQL files under `db/migrations/` in order at startup
- `db/migrate-encryption.ts` — one-shot rewrite of legacy CBC-encrypted columns to GCM

### `scripts/` — one-off/ad-hoc CLI maintenance scripts (not imported by the server)
- `scripts/backfill-email-date-utc.js` — normalizes historical email dates to UTC
- `scripts/email-search-embedding-backfill.js`, `scripts/email-search-embedding-status.js` — batch (re)compute and report embedding coverage for email search
- `scripts/email-search-retrieval-eval.js`, `scripts/seed-email-search-retrieval-eval.js` — email search retrieval quality eval and its fixture seeding
- `scripts/hydrate-actual-cache.js`, `scripts/prune-actual-cache.js` — warm and prune the local Actual Budget cache
- `scripts/reindex-emails.js` — additive time-windowed email re-index
- `scripts/reindex-icloud-mime.js` — targeted re-fetch/reindex of iCloud rows with undecoded raw MIME
- `scripts/reset-passkeys.js` — wipes passkey/session tables for local dev reset
- `scripts/triage-eval.js`, `scripts/triage-preflight-dry-run.js` — email triage model eval harness and preflight-rules dry run

### `test-utils/` — shared test-only helpers (not themselves test files, so mapped explicitly)
- `test-utils/auth-db.ts` — spins up an in-memory auth-schema db for tests
- `test-utils/completed-tasks-db.ts` — spins up an in-memory completed-tasks-schema db for tests
- `test-utils/temp-dir.ts` — Windows-safe temp-directory cleanup (libsql keeps file locks after close())

(Other tests are not listed: each file above has a same-named test file by convention.)

## Local patterns

- `index.js` is the only place that should construct the real HTTP server and register `process.on('SIGTERM'|'SIGINT', ...)` handlers — signal registration is untestable under Vitest, so `shutdown.js`'s `createGracefulShutdown` exposes a pure, injectable `shutdown(signal)` function instead of registering signal handlers itself; `scheduler.js` no longer registers any signal handler of its own (its former partial, VITEST-gated one was deleted — see REL-03) and only exposes `stopScheduler()` as one of the `stopFns` `index.js` passes in.
- `shutdown.js` must stay generic: it takes `stopFns` as a parameter and must never import a specific domain's stop function or `scheduler.js` directly.
- `auth/` and `db/` modules are one-way dependencies for domain code (e.g. `server/platform/`, `server/routes/`) — nothing under `auth/`/`db/` should import a domain.
- `scripts/` entries are run manually via `node server/scripts/<name>.js`, never imported by `index.js` or `scheduler.js`.

## Related

- Domain background-worker modules such as `server/email/email-backfill-worker.js` and `server/reminders/reminder-scheduler.js` — the individual stop functions `index.js` passes into `shutdown.js`'s `stopFns`
- `server/db/migrations/` — SQL files run by `db/migrate.ts`
