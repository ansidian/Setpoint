# EA Dashboard

A personal executive assistant dashboard that consolidates emails, calendars, weather, academic deadlines, tasks, and finances into one current operational view. Built to solve the problem of managing multiple email accounts and calendar events where things often get lost in the noise.

This is a work-in-progress personal project — not built with public use in mind. If you want to run it yourself, it's a BYOK (bring your own key) system via Anthropic and/or OpenAI.

Built with the help of Claude Opus 4.6.

## What it does

The dashboard fetches data from multiple sources, continuously indexes incoming email, and maintains active inbox snapshots that surface what actually matters:

- **Email triage** — Pulls from multiple Gmail and iCloud accounts, classifies emails as actionable/FYI/noise, extracts urgency flags, and groups by account. The Settings page controls whether continuous triage runs real models, uses no-model local rules, or pauses job draining.
- **Bill & transaction detection** — Extracts financial data (payee, amount, due date) from emails with optional one-click logging to Actual Budget
- **Calendar consolidation** — Aggregates Google Calendar events across all connected accounts with color coding, conflict detection, and a live now-marker timeline
- **Academic deadlines** — Fetches Canvas LMS assignments via [Canvas-LMS-Task-Manager](https://github.com/ansidian/Canvas-LMS-Task-Manager), with status tracking (incomplete/in-progress/complete)
- **Todoist integration** — Personal tasks merged and deduplicated with academic deadlines
- **Weather** — Current conditions and hourly forecasts via Pirate Weather
- **Continuous snapshots** — Incoming mail is indexed and attached to active snapshot windows so the Inbox can update between scheduled boundaries
- **Current data cache** — Boot-critical weather, calendar, deadline, bill, and provider-health data is cached for graceful degradation
- **Snapshot boundaries** — Cron-based schedule entries advance active snapshot windows without running a batch generator
- **Inbox search** — The Inbox tab searches the persisted email index (FTS5) across indexed INBOX mail for every account, with a resumable 365-day default backfill for historical coverage
- **Snapshot history** — Browse prior inbox snapshot windows from the current snapshot store
- **Important senders** — Configure priority senders for real-time browser notifications
- **Multi-account support** — Multiple Gmail (OAuth) and iCloud (app passwords) accounts with custom labels, colors, and icons

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 8, React Router 7, Tailwind CSS 4 |
| UI | shadcn/ui, Radix, Framer Motion |
| Backend | Express.js (Node.js 24.x) |
| Database | Turso (LibSQL) |
| AI | Anthropic and OpenAI providers for email triage and bill signals |
| Search | SQLite FTS5 email index |
| Email | Gmail (OAuth 2.0), iCloud (IMAP) |
| Calendar | Google Calendar API |
| Weather | Pirate Weather API |
| Finances | Actual Budget API |
| Tasks | Todoist API |
| Academic | Canvas LMS via CTM API |

For a detailed look at how everything fits together, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup (BYOK)

This project requires your own API keys and credentials.

### Environment variables

```bash
# Auth (run `node server/hash-password.js <your-password>` to generate)
EA_PASSWORD_HASH=$2b$12$...
EA_USER_ID=your-user-id

# Database (Turso)
TURSO_DATABASE_URL=libsql://your-ea-db.turso.io
TURSO_AUTH_TOKEN=

# Encryption key for stored credentials (64-char hex)
EA_ENCRYPTION_KEY=

# Email AI providers
ANTHROPIC_API_KEY=

# OpenAI (optional; enables OpenAI email AI and bill extraction providers)
OPENAI_API_KEY=

# Google OAuth (Gmail + Calendar)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-app.onrender.com/api/ea/accounts/gmail/callback
GMAIL_PUBSUB_TOPIC=projects/your-project/topics/gmail-push
GMAIL_PUBSUB_PUSH_TOKEN=long-random-webhook-token

# Todoist OAuth refresh + webhook verification
TODOIST_CLIENT_ID=todoist-developer-app-client-id
TODOIST_CLIENT_SECRET=todoist-developer-app-client-secret

# CTM API (Canvas LMS deadlines — optional)
CTM_API_URL=https://your-ctm-instance/api
CTM_API_KEY=

# Pirate Weather (optional)
PIRATE_WEATHER_API_KEY=

# Render (auto-suspend to save costs — optional)
RENDER_API_KEY=
RENDER_SERVICE_ID=

# Startup workers (optional)
EA_STARTUP_WORKER_DELAY_MS=
EA_STARTUP_WORKER_JITTER_MS=
EA_STARTUP_INDEXER_OFFSET_MS=
EA_STARTUP_BACKFILL_OFFSET_MS=
EA_STARTUP_TODOIST_SYNC_OFFSET_MS=
EA_EMAIL_BACKFILL_QUEUE_ON_STARTUP=
```

In production, startup workers are delayed so the web server can accept the
first dashboard requests before catch-up jobs start. The default worker delay is
60-120 seconds, with an extra 2 minutes before the passive email indexer and an
extra 10 minutes before email backfill. Backfill only resumes interrupted jobs
on startup by default; set `EA_EMAIL_BACKFILL_QUEUE_ON_STARTUP=1` to queue a
new broad backfill automatically.

### Todoist OAuth and webhook setup

The server uses `TODOIST_CLIENT_SECRET` to verify Todoist's
`X-Todoist-Hmac-SHA256` signature against the raw webhook body. It also uses
`TODOIST_CLIENT_ID` plus `TODOIST_CLIENT_SECRET` to refresh Todoist OAuth access
tokens before they expire.

In the Todoist Developer app console, configure the webhook callback URL to:

```text
https://your-app.onrender.com/api/todoist/webhook
```

Todoist requires webhook URLs to be HTTPS and to omit explicit ports. For local
testing, expose the Express server with a tunnel and use the tunnel HTTPS URL:

```text
https://<your-tunnel-host>/api/todoist/webhook
```

Todoist webhooks are tied to a Todoist app. For personal use, Todoist documents
that webhooks do not fire for the app creator by default; activate them by
completing that Todoist app's OAuth flow for your own account. Use scopes:

```text
data:read_write,data:delete
```

After exchanging the OAuth code for JSON containing `access_token`,
`refresh_token`, and `expires_in`, store that full JSON response through the
authenticated settings API. The app encrypts the access and refresh tokens,
tracks expiry, and refreshes before Todoist REST/Sync calls:

```bash
curl -X PUT "https://ea.andysu.tech/api/ea/settings" \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: EADashboard" \
  -H "Cookie: ea_session=<your-session-cookie>" \
  --data-binary @- <<'JSON'
{
  "todoist_oauth_token_response": {
    "access_token": "...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "refresh_token": "...",
    "scope": "data:read_write,data:delete"
  }
}
JSON
```

Existing long-lived personal Todoist tokens still work. Setting a personal token
through the Settings UI clears OAuth refresh metadata and uses personal-token
mode.

### Running locally

```bash
npm install
npm run dev        # runs both Vite (frontend) and Express (backend) concurrently
```

Frontend: `http://localhost:5173` — proxies `/api/*` to Express on port 3001.

By default, `email_triage_mode = auto` resolves to `no_model` outside production, so `npm run dev` can index and show incoming mail without spending model budget. Production `auto` resolves to `real`. Change the mode under Settings → System when you intentionally want real local triage or need to pause triage job draining.

### Production

```bash
npm run build      # Vite build → dist/
npm start          # Express serves dist/ + API routes
```

Database migrations run automatically on server start. The checked-in migration
set is a current-schema baseline for fresh databases; existing production
databases are expected to already contain the same current snapshot schema.

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — free to use and adapt for non-commercial purposes with attribution.
