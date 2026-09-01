# Setpoint

![Setpoint](docs/assets/repo-hero.png)

A personal executive-assistant dashboard that consolidates email, calendar, tasks, reminders, weather, bills, and a desktop ideas canvas into one current operational view. It is built to solve the daily problem of managing multiple inboxes, calendars, tasks, and financial signals without losing important work in the noise.

Setpoint is a private BYOK system. Bring your own OpenAI or Anthropic API key: email triage and bill extraction can run on either provider, while semantic inbox search uses OpenAI embeddings and answer generation.

## Live Demo

<p align="center">
  <a href="https://ansidian.github.io/Setpoint/">
    <img alt="Open live demo" src="https://img.shields.io/badge/Live%20Demo-Open%20Portfolio%20Build-7c3aed?style=for-the-badge">
  </a>
  <img alt="Static fictional data" src="https://img.shields.io/badge/Data-Fictional%20Static%20Seed-475569?style=for-the-badge">
  <img alt="No login required" src="https://img.shields.io/badge/Auth-No%20Login%20Required-0f766e?style=for-the-badge">
</p>

The live demo is a static GitHub Pages build with rolling fictional data. It bypasses auth for the portfolio build and does not call the private backend, provider APIs, email accounts, calendars, Actual Budget, or AI services.

## What it does

The dashboard fetches data from multiple sources, continuously indexes incoming email, and maintains active inbox snapshots that surface what actually matters:

- **Email triage** — Pulls from multiple Gmail and iCloud accounts, classifies emails as actionable/FYI/noise, extracts urgency flags, and groups by account. The Settings page controls whether continuous triage runs real models, uses no-model local rules, or pauses job draining.
- **Semantic inbox search** — Searches the persisted email index with SQLite FTS5, OpenAI embeddings, and an Ask AI answer path over retrieved mail.
- **Bill detection and bill pay** — Extracts payee, amount, due date, and payment context from emails, resolves bill-pay mappings, and connects bill actions to Actual Budget.
- **Calendar workspace** — Aggregates Google Calendar events across connected accounts with event creation/editing, deadline and bill overlays, reminders, and a local search mirror for fast calendar search.
- **Todoist integration** — Syncs personal tasks, supports Todoist OAuth refresh and webhooks, creates/edits/deletes tasks, and preserves completed recurring occurrences long enough for the UI to stay stable.
- **Weather** — Shows current conditions and forecasts via Pirate Weather.
- **Continuous snapshots** — Indexes incoming mail and attaches it to active snapshot windows so the Inbox can update between scheduled boundaries.
- **Current data cache** — Caches boot-critical weather, calendar, deadline, bill, inbox, and provider-health data for graceful degradation.
- **Snapshot boundaries** — Cron-based schedule entries advance active email snapshot windows without running a batch generator.
- **Snapshot history** — Browses prior inbox snapshot windows from the current snapshot store.
- **Important senders and notifications** — Configures priority senders, browser notifications, triage notification sounds, and private Discord reminder delivery.
- **Desktop Notes canvas** — Uses a licensed tldraw workspace as an infinite dumping ground for project plans, bugs, feature lists, and personal ideas. Unsaved work recovers locally across refreshes, while confirmed documents remain revision-safe across devices and refresh-based rather than realtime.
- **Multi-account support** — Supports multiple Gmail OAuth and iCloud IMAP accounts with custom labels, colors, and icons.
- **Operational controls** — Includes settings for provider credentials, model selection, account order, schedules, Actual Budget, Todoist, reminders, passkeys, and scoped API tokens.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 8, React Router 7, Tailwind CSS 4 |
| UI | shadcn/ui, Radix, Framer Motion, tldraw |
| Backend | Express.js (Node.js 24.x) |
| Database | Turso (LibSQL) |
| AI | BYOK Anthropic and OpenAI providers for email triage and bill extraction; OpenAI for semantic inbox search |
| Search | SQLite FTS5 email index, OpenAI embeddings, optional Turso/libSQL native vectors |
| Email | Gmail (OAuth 2.0), iCloud (IMAP) |
| Calendar | Google Calendar API |
| Weather | Pirate Weather API |
| Finances | Actual Budget API |
| Tasks | Todoist API |

The Notes tab is intentionally desktop-only and absent from the static demo. Production requires a tldraw hobby license under **Settings → Connections → tldraw**; local development opens Notes without a key, matching tldraw's development license behavior. A configured key is encrypted at rest but returned to the authenticated production browser because tldraw validates it client-side. Images and videos are stored privately under `EA_TLDRAW_ASSET_DIR`; production Render deployments require the persistent disk declared in `render.yaml`.

For a detailed look at how everything fits together, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Deploy on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ansidian/Setpoint/tree/master)

The Blueprint creates one native Node 24 web service on Render's paid Starter
plan. It asks for only a [Turso](https://turso.tech/) database URL and auth token;
Render generates the 256-bit `EA_ENCRYPTION_KEY` and a separate first-claim
`EA_SETUP_TOKEN`. Starter is intentionally
always on because Setpoint's schedulers, reconciliation jobs, and reminders stop
when a service sleeps. Check Render's current pricing before creating the
service; the free plan is not a supported Setpoint production configuration.

1. Create a Turso database and token, then click **Deploy to Render**.
2. Enter `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when Render prompts.
3. Wait for `/healthz` to pass, copy the generated `EA_SETUP_TOKEN` from the
   service environment, then open the service URL and claim the instance by
   entering that token, confirming the canonical URL, and creating an owner
   password of at least 12 characters.
4. Save the one-time recovery codes offline, then use the skippable onboarding
   checklist to connect email/calendar, AI, tasks, weather, finances, and
   notifications as useful. Provider credentials are entered write-only inside
   Setpoint; they are not required to boot the service.

Turso and the root key are separate parts of the backup boundary. Copy the
generated `EA_ENCRYPTION_KEY` from Render's environment settings into a secure
password manager or secret backup. Setpoint cannot display or reconstruct it.
A Turso backup without that exact key cannot decrypt stored credentials, and a
key backup without the Turso database does not restore the installation.

### Environment variable groups

The complete template is in [`.env.example`](.env.example):

- **Required production bootstrap:** `TURSO_DATABASE_URL`,
  `TURSO_AUTH_TOKEN`, a 256-bit hex or base64 `EA_ENCRYPTION_KEY`, and a random
  `EA_SETUP_TOKEN` of at least 32 characters for the one-time owner claim.
- **Optional advanced provider sources:** AI, Google, Todoist, Pirate Weather,
  Google Places, and Gmail Pub/Sub values. Normal setup stores these write-only
  in Setpoint; existing host values remain supported and can be migrated from
  Settings without revealing them.
- **Operational tuning and compatibility:** worker timing, local-development
  switches, and legacy owner/origin imports. Fresh installs do not set an owner
  ID, password hash, WebAuthn origin, or redirect URI.

Financial emails use one zero-configuration planning path for semantic purpose,
canonical amount, Actual target inference, reconciliation, and explicit review.
Final plans are persisted so reopening an email does not repeat model work;
generic unattended execution remains disabled until its observe-only safety gates pass.

Production startup delays workers so the web server can accept initial requests
before catch-up jobs start. The default worker delay is 60–120 seconds, with an
extra 2 minutes before the passive email indexer and an extra 10 minutes before
email backfill. Backfill resumes interrupted jobs by default; set
`EA_EMAIL_BACKFILL_QUEUE_ON_STARTUP=1` only to queue a new broad backfill.

### Dashboard auth and passkey recovery

On a fresh database, open Setpoint after startup, enter the out-of-band
`EA_SETUP_TOKEN`, confirm the visible canonical URL, and create the owner
password in the browser. The first successful claim atomically creates the
stable owner ID, stores only the bcrypt password hash, persists the confirmed
origin, signs that browser in, and permanently closes public setup. The setup
token is compared in constant time and is never stored in the database or
returned by the app. Provider APIs and background workers remain disabled until
the claim succeeds. `GET /healthz` reports readiness without disclosing claim
state.

Existing installations may keep `EA_USER_ID` and `EA_PASSWORD_HASH`; startup
imports that exact legacy identity once. Partial or conflicting legacy auth
configuration fails closed instead of reopening public setup.

The private app accepts either the owner password or a registered WebAuthn
passkey by default. Registering a passkey does not disable password login.
Settings -> System can explicitly enable strict password-plus-passkey login;
identity and access changes require a password confirmation from the last ten
minutes. A passkey-only session can use the dashboard but cannot register or
remove credentials, change the password or mode/domain, regenerate recovery
codes, or mint/revoke API tokens until that password step-up succeeds.

Fresh owner claim displays eight one-time offline recovery codes. Setpoint
stores only their hashes and never returns them through normal Settings reads.
Using one code replaces the owner password, clears passkeys and pending auth,
revokes prior sessions and API tokens, and displays a replacement recovery-code
set once.

The confirmed canonical URL derives the WebAuthn RP ID/origin and provider
callback URLs. Existing compatible `EA_WEBAUTHN_*` and `GOOGLE_REDIRECT_URI`
values are imported once when they identify the same origin; ambiguous legacy
values remain active compatibility fallbacks and are never silently rewritten.
Changing the domain in Settings requires recent password confirmation and shows
the affected passkeys and external callback registrations first.

If both normal sign-in and offline recovery are unavailable, use the local
operator reset script against the intended database:

```bash
npm run auth:reset-passkeys -- --dry-run
npm run auth:reset-passkeys -- --confirm
```

The reset clears registered passkeys, pending password-auth attempts, WebAuthn
challenges, and browser sessions, increments the owner's security generation,
and restores password-or-passkey mode. Scoped API tokens are separate automation
credentials and do not grant dashboard login; an in-app offline recovery revokes
them as part of the credential reset.

### Opt-in Turso semantic search verification

Normal `npm run dev` uses the local SQLite fallback and does not require Turso.
To test inbox Ask AI against Turso/libSQL native vectors, opt in explicitly:

```bash
npm run ai-search:embedding-status -- --adapter=turso
npm run ai-search:backfill -- --adapter=turso --limit=25
npm run dev:ai-search-turso
```

The Turso commands require `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`EA_USER_ID`, and `OPENAI_API_KEY` when backfilling. `dev:ai-search-turso` sets
`AI_SEARCH_VECTOR_ADAPTER=turso` and disables the periodic embedding worker, so
semantic coverage changes only when you run an explicit bounded backfill.

### Todoist OAuth and webhook setup

The default setup is a personal API token entered in Settings. It supports full
Todoist read/write behavior and uses periodic reconciliation; OAuth is not
required.

For optional OAuth refresh and real-time webhooks, open **Settings → Connections
→ Todoist**, expand **Advanced OAuth and webhooks**, and enter the client ID and client secret from your deployment's
Todoist Developer app. Set the OAuth callback and webhook URLs in Todoist to the
canonical URLs shown there, then choose **Connect with OAuth**. Setpoint binds the
callback to the initiating browser, exchanges the code server-side, encrypts the
access and refresh tokens, and promotes replacement app credentials only after a
successful callback.

`TODOIST_CLIENT_ID` and `TODOIST_CLIENT_SECRET` remain supported as advanced host
fallbacks. Settings identifies that source and can migrate both values into
Setpoint without revealing them. Webhook HMAC verification and token refresh
resolve the current credentials at request time, so replacements do not require
a restart. Saving a personal token later explicitly returns the connection to
personal-token mode and periodic delivery.

### Running locally

```bash
npm install
npm run dev        # runs both Vite (frontend) and Express (backend) concurrently
```

Frontend: `http://localhost:5173` — proxies `/api/*` to Express on port 3001.

By default, `email_triage_mode = auto` resolves to `no_model` outside production, so `npm run dev` can index and show incoming mail without spending model budget. Production `auto` resolves to `real`. Change the mode under Settings → Automation when you intentionally want real local triage or need to pause triage job draining.

### Tests

```bash
npm run test:fast  # local feedback without real filesystem/libsql/Actual integrations
npm run test:slow  # real filesystem, file-backed libsql, and Actual compatibility tests
npm test           # complete required non-Playwright suite (fast + slow)
```

CI requires both the fast and slow commands and reports them as separate steps.
Playwright remains opt-in through the `test:e2e*` commands.
Filesystem fixtures are contained under the `setpoint-tests` child of the OS
temp directory. Windows-locked residue is retained for a 24-hour safety window,
then later test processes remove at most 100 stale entries per sweep.

### Production

```bash
npm run build      # Vite build → dist/
npm start          # Express serves dist/ + API routes
```

Database migrations run automatically on server start. The checked-in migration
set is a current-schema baseline for fresh databases; existing production
databases are expected to already contain the same current snapshot schema.

## License

[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/) — free to use and adapt for non-commercial purposes with attribution.
