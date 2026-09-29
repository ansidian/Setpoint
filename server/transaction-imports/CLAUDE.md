# Transaction Import Domain Map

Read-only saved transaction-import history and the shared financial worker runtime. The old import queue no longer admits, confirms, retries or executes work. New provider parsing belongs to `server/financial-parsers/`; modern document/event intake belongs to `server/financial-events/`.

## Files

- `transaction-import-store.ts` — read-only per-email item history and bounded redacted dashboard activity; Inbox reads expose latest correction status and last verified effective results without rewriting original owner fields; no mapping-table access
- `transaction-import-activity.ts` — bounded dashboard activity read projections of settled history, including verified corrected amounts/payees; retired imports never report review work
- `transaction-import-store-projections.ts` — database-row projections for saved runs and items, including historical captured targets/modes
- `transaction-import-runtime.ts` — shared bounded financial-document/event drains, startup stale recovery, correction recovery, ready-event priority between provider work, durable recovery deadlines, and graceful shutdown

- `transaction-import.test-utils.ts` — saved run/item seed fixtures for ephemeral history tests; the product no longer creates import rows

## Local patterns

- Amounts are signed integer cents and dates are `YYYY-MM-DD`.
- Saved items are inspection-only history: no completion, retry, dismissal or correction.
- Durable plan JSON omits model/body evidence excerpts while retaining target provenance, reconciliation, and eligibility reasons.
- Raw Gmail message IDs remain distinct from RFC Message-ID headers.
- Legacy `ea_transaction_import_mappings` rows and import tables remain untouched for audit only; retirement deletes no configuration or history.

## Boundaries

- Gmail provider calls belong in `server/email/gmail.ts`; indexed arrivals wake the shared runtime directly.
- Actual Budget access belongs under `server/actual/`.
