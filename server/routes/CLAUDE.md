# Server Routes Map

The HTTP surface: Express routers that validate input, apply auth, and delegate to the `server/<domain>/` services (email, bills, calendar, snapshots, tasks, reminders, triage, actual, platform). `briefing/index.ts` mounts the briefing sub-routers behind shared auth middleware; root-level routers cover auth, accounts, integrations, and webhooks.

## Files

### Auth + accounts
- `auth.ts` — setup-token owner claim, password/passkey login, passkey registration/deletion, session check/logout, and the mount point for the security subrouter
- `auth-security.ts` — password step-up, canonical/auth-mode/password/recovery mutations, and scoped API-token management
- `auth-canonical-origin.ts` — canonical-domain status, impact preview, and password-step-up/generation-gated mutation
- `accounts.ts` — Gmail OAuth callback and account binding; mounts settings/reminders routers

### Briefing
- `briefing/index.ts` — mounts briefing sub-routers, applies auth middleware
- `briefing/bills.ts` — resolves financial-email plans, extracts manual financial emails, sends owner-confirmed bills to Actual Budget, and creates quick transactions
- `briefing/email.ts` — email bodies, dismiss/snooze, inbox search
- `briefing/email-index.ts` — email index health checks, backfill queuing
- `briefing/snapshot.ts` — snapshot fetch/sync, kanban lane reorder
- `briefing/tasks.ts` — Todoist projects and labels listing
- `briefing/transaction-imports.ts` — transaction-import scans, status, confirm/commit, retry, dismiss, resume and revision-checked owner completion of managed financial events; no source configuration endpoints
- `briefing/dev.ts` — dev-only email re-indexing endpoint

### Domains + integrations
- `alfred.ts` — Alfred model-free email-context prepare/discard, assistant run stream with response-disconnect cancellation and retryable attachment release, identity-only proposal Created acknowledgement, and conversation reset; wires read-only domain deps
- `calendar.ts` — calendar CRUD validation/provider orchestration, deadline reads, event search, and reminder hydration; successful event-write effects delegate to the calendar domain
- `calendar-bills-range.ts` — composes bill occurrences with read-only Actual transactions and independent degradation
- `dashboard.ts` — dashboard state, current-data SSE stream, health checks, and read-only finance cards
- `tldraw.ts` — authenticated Notes bootstrap, revisioned document saves, and private content-addressed media
- `news.ts` — News tab: topics/sources CRUD, starter-catalog import, add-source preview, seen-marker, manual refresh
- `reminders.ts` — Discord reminder testing and configuration
- `settings.ts` — user settings, model selection, and active integration configs; legacy Bill Pay mappings are retained only in storage and are not exposed
- `gmail-push.ts` — Gmail Pub/Sub push intake, queues history syncs
- `todoist-webhook.ts` — Todoist webhook deliveries with signature verification
- `todoist-oauth.ts` — Todoist OAuth begin/callback/status routes with callback-scoped browser binding
- `instance-credentials.ts` — authenticated metadata and write-only deployment credential mutations; dispatches allowlisted validation/promotion and Gmail Pub/Sub lifecycle actions to provider-owned managers
- `capabilities.ts` — authenticated, metadata-only capability status projection with optional explicit refresh
- `onboarding.ts` — authenticated, allowlisted onboarding progress, finish, and reopen mutations

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Routes stay thin: validation + status mapping; domain logic belongs in the `server/<domain>/` services.
- Errors propagate with `err.status`; handlers translate to HTTP codes rather than inventing new ones.
- Single-user instance assumption (`EA_USER_ID`); webhooks verify signatures before touching services.

## Related

- `server/<domain>/` directories — service layers these routes delegate to (see their maps)
- `dashboard.ts` SSE stream is the push channel the frontend caches listen to
