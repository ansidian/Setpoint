# Demo Map

Build-time fictional walkthrough (`VITE_EA_DEMO=1`). `src/api.ts` routes demo requests here before any real provider or server work. Data and mutations live in memory and reset on page refresh; no runtime/query toggle or persistent demo state.

## Files

### Routing and state
- `config.ts` — build-time mode check and explicit `DEMO_API_UNHANDLED` error.
- `apiAdapter.ts` — demo request dispatcher and calendar, task, reminder, settings, and connection-safe handlers.
- `dashboardAdapter.ts` — fictional dashboard envelope and source retry timestamps; updates only in-memory seed state.
- `apiHandler.ts` — shared request contracts, unhandled sentinel, URL path helpers, and not-found errors.
- `referenceAdapter.ts` — read/reference responses for settings controls, Actual metadata lists, usage, dashboard finance, and inert managed financial review/change feeds.
- `store.ts` — rolling fictional seed, shared in-memory state, mutation forks, and Pacific date projection.
- `demoSafeLocalStorage.ts` — inert storage facade for demo call sites that must not persist data.
- `dateRange.ts` — bounded date-range filtering shared by demo domain reads.
- `capabilities.ts` — fictional redacted capability and instance-credential status; contains no real credentials.
- `todoistSetupAdapter.ts` — demo-safe Todoist setup/status responses.

### Mail and finance
- `inboxData.ts` — fictional email accounts, snapshot lanes, and email bodies.
- `snapshotRows.ts` — snapshot row collection and lookup helpers.
- `snapshotAdapter.ts` — in-memory snapshot history, mail actions, read state, and body/search responses.
- `emailAttachments.ts` — local fictional attachment descriptors and content.
- `emailAiUsageData.ts` — fictional email-AI usage and legacy triage statistics.
- `financeData.ts` — shared fictional transactions, confirmed-import mutation, and calendar Bills range projection.
- `dashboardFinance.ts` — spending comparisons and category totals derived from the shared seed plus import activity.
- `transactionImports.ts` — fictional import runs/items, shared pending-review predicate, paginated pending runs, safe receipt bodies, and in-memory confirmation/retry/dismiss actions.

### Other feeds
- `weatherData.ts` — fictional current conditions and forecast.
- `newsData.ts` — fictional news topics, feeds, and headlines.
- `newsAdapter.ts` — in-memory news read, source/topic, and refresh handlers.

Tests are not listed here; follow `AGENTS.md` behavior-ownership guidance.

## Boundaries

- Unsupported API exports must fail explicitly rather than fall through to `/api/*`, authentication, providers, SSE, AI, or external-service navigation.
- Finance spending and calendar transactions share `seed.transactions`; import confirmation updates that same in-memory ledger. Unconfirmed review candidates must not already count as recorded spending.
- Demo connection flags describe simulated state only. Keep real passwords, tokens, provider operations, and persistent settings out of this directory.
- Canonical product behavior and provider writes remain in their production domains; this directory supplies only the walkthrough contract.
