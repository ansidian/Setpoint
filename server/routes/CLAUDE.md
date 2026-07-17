# Server Routes Map

The HTTP surface: Express routers that validate input, apply auth, and delegate to the `server/<domain>/` services (email, bills, calendar, snapshots, tasks, reminders, triage, actual, platform). `briefing/index.js` mounts the briefing sub-routers behind shared auth middleware; root-level routers cover auth, accounts, integrations, and webhooks.

## Files

### Auth + accounts
- `auth.ts` — login, passkey registration, WebAuthn, session management
- `accounts.ts` — Gmail OAuth callback and account binding; mounts settings/reminders routers

### Briefing
- `briefing/index.js` — mounts briefing sub-routers, applies auth middleware
- `briefing/bills.ts` — sends bills to Actual Budget, quick transactions
- `briefing/email.ts` — email bodies, dismiss/snooze, inbox search
- `briefing/email-index.ts` — email index health checks, backfill queuing
- `briefing/snapshot.ts` — snapshot fetch/sync, kanban lane reorder
- `briefing/tasks.ts` — Todoist projects and labels listing
- `briefing/dev.ts` — dev-only email re-indexing endpoint

### Domains + integrations
- `alfred.js` — Alfred assistant run stream (SSE `POST /run`), conversation reset; wires the read-only tool deps
- `calendar.ts` — calendar CRUD, deadline reads, event search, reminder hydration
- `calendar-bills-range.ts` — composes bill occurrences with read-only Actual transactions and independent degradation
- `dashboard.ts` — dashboard state, current-data SSE stream, health checks
- `notes.ts` — notes CRUD and reordering
- `news.ts` — News tab: topics/sources CRUD, starter-catalog import, add-source preview, seen-marker, manual refresh
- `reminders.ts` — Discord reminder testing and configuration
- `settings.ts` — user settings, model selection, integration configs
- `gmail-push.ts` — Gmail Pub/Sub push intake, queues history syncs
- `todoist-webhook.ts` — Todoist webhook deliveries with signature verification

Tests are not listed; adjacent test files cover their same-named route by convention.

## Local patterns

- Routes stay thin: validation + status mapping; domain logic belongs in the `server/<domain>/` services.
- Errors propagate with `err.status`; handlers translate to HTTP codes rather than inventing new ones.
- Single-user instance assumption (`EA_USER_ID`); webhooks verify signatures before touching services.

## Related

- `server/<domain>/` directories — service layers these routes delegate to (see their maps)
- `dashboard.ts` SSE stream is the push channel the frontend caches listen to
