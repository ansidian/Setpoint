# EA Dashboard

A personal executive assistant dashboard that consolidates emails, calendars, weather, academic deadlines, tasks, and finances into a single AI-powered daily briefing. Built to solve the problem of managing multiple email accounts and calendar events where things often get lost in the noise.

This is a work-in-progress personal project — not built with public use in mind. If you want to run it yourself, it's a BYOK (bring your own key) system via the Claude API.

Built with the help of Claude Opus 4.6.

## What it does

The dashboard fetches data from multiple sources, sends it through Claude for analysis, and produces a structured briefing that surfaces what actually matters:

- **Email triage** — Pulls from multiple Gmail and iCloud accounts, classifies emails as actionable/FYI/noise, extracts urgency flags, and groups by account
- **Bill & transaction detection** — Extracts financial data (payee, amount, due date) from emails with optional one-click logging to Actual Budget
- **Calendar consolidation** — Aggregates Google Calendar events across all connected accounts with color coding, conflict detection, and a live now-marker timeline
- **Academic deadlines** — Fetches Canvas LMS assignments via [Canvas-LMS-Task-Manager](https://github.com/ansidian/Canvas-LMS-Task-Manager), with status tracking (incomplete/in-progress/complete)
- **Todoist integration** — Personal tasks merged and deduplicated with academic deadlines
- **Weather** — Current conditions and hourly forecasts via Pirate Weather
- **AI insights** — Claude generates 2-4 actionable insights connecting information across emails, calendar, and deadlines. Date references use a typed slot system that auto-updates as the day progresses — "tonight at 8pm" becomes "last night at 8pm" the next morning without regenerating the briefing
- **Delta refresh** — On subsequent refreshes, only new emails are sent to Claude and merged with previous triage to save tokens
- **Skip AI** — When inbox is clean and calendar unchanged, clones the previous briefing without an API call
- **Live data** — 5-minute background polling for new emails, calendar changes, and weather updates between briefings
- **Scheduled generation** — Cron-based briefing generation at user-defined times and timezones
- **Briefing search** — Vector similarity search across briefing history with Claude-powered result analysis, plus `@` prefix keyword search across all indexed emails (FTS5) to quickly find which account an email came from
- **Briefing history** — Browse and compare past briefings
- **Important senders** — Configure priority senders for real-time browser notifications
- **Multi-account support** — Multiple Gmail (OAuth) and iCloud (app passwords) accounts with custom labels, colors, and icons

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 8, React Router 7, Tailwind CSS 4 |
| UI | shadcn/ui, Radix, Framer Motion |
| Backend | Express.js (Node.js 24.x) |
| Database | Turso (LibSQL) |
| AI | Claude API (Sonnet/Haiku, configurable) |
| Search | OpenAI embeddings (text-embedding-3-small) |
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

# Claude API
ANTHROPIC_API_KEY=

# OpenAI (embeddings for briefing search — optional)
OPENAI_API_KEY=

# Google OAuth (Gmail + Calendar)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-app.onrender.com/api/ea/accounts/gmail/callback

# CTM API (Canvas LMS deadlines — optional)
CTM_API_URL=https://your-ctm-instance/api
CTM_API_KEY=

# Pirate Weather (optional)
PIRATE_WEATHER_API_KEY=

# Render (auto-suspend to save costs — optional)
RENDER_API_KEY=
RENDER_SERVICE_ID=
```

### Running locally

```bash
npm install
npm run dev        # runs both Vite (frontend) and Express (backend) concurrently
```

Frontend: `http://localhost:5173` — proxies `/api/*` to Express on port 3001.

### Production

```bash
npm run build      # Vite build → dist/
npm start          # Express serves dist/ + API routes
```

Database migrations run automatically on server start.

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — free to use and adapt for non-commercial purposes with attribution.
