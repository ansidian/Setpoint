# Shared Types Map

Cross-layer, serializable contracts used by the server and client. Keep domain behavior out of this directory; runtime validation remains at route and service boundaries.

## Files

- `accounts.ts`, `settings.ts`, `setup.ts`, `instance-credentials.ts`, `canonical-url.ts`, `onboarding.ts`, `capabilities.ts` — owner setup, credentials, and integration settings contracts
- `dashboard.ts`, `snapshots.ts`, `email.ts`, `calendar.ts`, `tasks.ts`, `reminders.ts`, `tldraw.ts`, `news.ts` — product surface read/write contracts; `email.ts` owns the bounded verification-code kind and `snapshots.ts` owns its active-view metadata; `calendar.ts` also owns the serializable event create-seed/source-intent and client-coordination value shapes
- `actual.ts`, `bills.ts` — Actual Budget connection/config and schedule-occurrence contracts, and the schedule mirror health and Actual connection/cache responses
- `alfred.ts` — Alfred assistant request/response, tool, calendar-proposal, and SSE contracts
- `ai-usage.ts` — triage provider-call usage rollups and production/evaluation dimensions

## Boundaries

- Files here must remain serializable and side-effect free.
- Provider SDK types and database row shapes stay in their owning server domains.


- `finances.ts` — budget-bound utilities, source-grounded utility/card statements and Journal topology

- `payment-groups.ts` — stable recurring display identities and ordered, revisioned payment organization
