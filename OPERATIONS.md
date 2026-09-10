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

## Production

The [Render Blueprint](render.yaml) provisions an always-on Starter Node service and a persistent asset disk. Supply `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; Render generates `EA_ENCRYPTION_KEY` and `EA_SETUP_TOKEN`. The service builds with `npm ci && npm run build`, starts with `npm start`, and checks readiness at `/healthz`.

After deployment, retrieve the generated setup token from the service environment and claim the instance in the browser. The owner password must have at least 12 characters. Save the one-time recovery codes, then use Settings to connect providers. Provider credentials are not required to boot. Workers remain inactive until the owner claim succeeds.

Other hosts need the same bootstrap values, an always-running Node process, and persistent storage for uploaded Notes assets. Production requires Turso. Database migrations run at server startup.

Back up **both the database and its exact `EA_ENCRYPTION_KEY`**. The app cannot recover that key, and the database alone cannot decrypt stored credentials. Back up uploaded Notes media separately from `EA_TLDRAW_ASSET_DIR` (Render: `/var/data/tldraw-assets`). Production Notes also requires a tldraw license configured in Settings → Connections.

Normal provider configuration lives in Settings. After connecting Actual, configure Financial Profiles in Settings → Finance: choose each utility’s existing schedule, savings/card endpoints for scheduled card payments, and reusable receipt/refund destinations. Actual target names load automatically; unavailable targets show a readable status and retry instead of internal identifiers. Create profile appears for emails with a recognized financial event classification other than `other`. It seeds an unsaved, enabled draft with its sender and available context; select missing targets before saving. Migration 069 starts with no enabled profiles and does not adopt retired mappings or Utilities membership. Unmatched receipts/refunds wait for review; reminder and completed-payment notices are ignored. Review can also suggest an enabled, unsaved profile draft for explicit setup. Card profiles require explicit scheduled-payment confirmations with numeric payment amounts. Statements and AutoPay enrollment do not establish a payment amount/date. Optional host-managed credentials and startup/backfill timing switches remain documented in `.env.example`.

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

- `npm run financial-email:observe` reports financial-email coverage and event outcomes.
- `npm run triage:preflight` checks triage rules; `npm run triage:eval` evaluates models. Real evaluations need the owner's `EA_USER_ID` to load model settings and are excluded from production AI usage analytics.
- `npm run actual -- <command>` is for ad-hoc inspection. Runtime integrations use the in-process Actual API.
