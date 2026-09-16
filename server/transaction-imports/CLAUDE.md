# Transaction Import Domain Map

Saved transaction-import history, bounded legacy recovery, and the shared financial worker runtime. New provider parsing belongs to `server/financial-parsers/`; modern document/event intake belongs to `server/financial-events/`.

## Files

- `transaction-import-store.ts` — durable run, item, item claim, recovery, and per-email status persistence; bounded redacted dashboard activity; Inbox reads expose latest correction status and last verified effective results without rewriting original owner fields; no mapping-table access
- `transaction-import-activity.ts` — existing bounded dashboard activity read projections, including verified corrected amounts/payees
- `transaction-import-store-projections.ts` — database-row projections for durable runs and items, including historical captured targets/modes
- `financial-email-preflight.ts` — pre-activation generic USD staging with atomic retirement fences; owns redacted saved plans and expense preview eligibility
- `financial-email-transfer.ts` — shared payment identity across reminder emails, separate transfer preview/commit/recovery, durable attempt admission and schedule-aware outcomes
- `transaction-import-service.ts` — supported saved-item confirmation, retry, dismissal, and inspection
- `transaction-import-worker.ts` — Actual preview/commit drains; settled batches publish the shared financial signal and recovered original imports reuse Actual invalidation
- `transaction-import-runtime.ts` — shared bounded financial-document/event and legacy-import drains, startup stale recovery, ready-event priority between provider work, durable recovery deadlines, and graceful shutdown

- `transaction-import.test-utils.ts` — shared saved-state reader and explicit profile-authorized saved-item fixtures for ephemeral import behavior tests

## Local patterns

- Amounts are signed integer cents and dates are `YYYY-MM-DD`.
- New legacy run/item insertion is atomically fenced after the provider epoch. Registered providers never enter generic preflight. Unsubmitted legacy rows retain source evidence and history but do not advertise or accept original execution actions.
- Saved confirmed items and immutable admitted operations retain recovery authority. Retry, claim and attention projections share epoch eligibility; correction and duplicate guards remain in force.
- Transfer jobs share a stable identity for owner, source, destination, cents and date across reminder messages. Preview binds the Actual budget; a conditional persisted attempt marker admits one create call. Every later claim with that marker only reconciles, including manual retry and stale-claim recovery. Today/past notices without a match stay review. Transfers never enter expense import groups.
- Generic financial-email items require a matching enabled profile for an unconfirmed first write. Profile revision and budget are checked again at atomic admission; queued pre-profile plans become review-only. Already attempted operations retain their captured recovery authority. Before activation, enabled USD expenses and income transactions enter automatic mode with `automatic_safe = 0`; only a would-add preview plus a previously passed current-Actual duplicate check and all plan gates can promote them to ready/automatic-safe. Income cents stay positive and the Actual import Adapter writes every imported transaction uncleared. Existing observe-only items still require confirmation, and updates remain review-only.
- Planner no-write outcomes never enter generic preflight, including duplicates matched to existing Actual activity without a generic imported ID.
- Durable plan JSON must omit model/body evidence excerpts while retaining target provenance, reconciliation, and eligibility reasons.
- Raw Gmail message IDs remain distinct from RFC Message-ID headers.
- Raw bodies are transient input and must not cross persistence/status boundaries.
- Legacy `ea_transaction_import_mappings` rows remain untouched for audit/recovery only; retirement does not delete configuration or import history.

## Boundaries

- Gmail provider calls belong in `server/email/gmail.ts`; indexed arrivals wake the shared runtime directly.
- Actual Budget access belongs under `server/actual/`.

Historical scan admission and execution are retired. Only arrival-owned items may be claimed, confirmed, retried or admitted for an original Actual write. Saved historical records remain inspectable and eligible for exact corrections.
