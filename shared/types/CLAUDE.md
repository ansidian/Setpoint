# Shared Types Map

Cross-layer, serializable contracts used by the server and client. Keep domain behavior out of this directory; runtime validation remains at route and service boundaries.

## Files

- `accounts.ts`, `settings.ts`, `setup.ts`, `instance-credentials.ts`, `canonical-url.ts`, `onboarding.ts`, `capabilities.ts` — owner setup, credentials, and integration settings contracts
- `dashboard.ts`, `snapshots.ts`, `email.ts`, `calendar.ts`, `tasks.ts`, `reminders.ts`, `tldraw.ts`, `news.ts` — product surface read/write contracts; `email.ts` owns the bounded verification-code kind and `snapshots.ts` owns its active-view metadata; `calendar.ts` also owns the serializable event create-seed/source-intent and client-coordination value shapes
- `actual.ts`, `bills.ts`, `transactions.ts`, `transaction-imports.ts` — Actual Budget, bills and zero-configuration financial-email plan contracts, transaction reads, and email transaction-import contracts
- `alfred.ts` — Alfred assistant request/response, tool, calendar-proposal, and SSE contracts

## Boundaries

- Files here must remain serializable and side-effect free.
- Provider SDK types and database row shapes stay in their owning server domains.
