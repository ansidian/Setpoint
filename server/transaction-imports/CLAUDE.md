# Transaction Import Domain Map

Deterministic Gmail email-to-transaction parsing and bounded historical discovery. This domain emits normalized candidates; durable orchestration and Actual writes remain separate concerns.

## Files

- `transaction-import-types.ts` — parser, candidate, evidence, warning, and automatic-safety contracts
- `parsers/parser-utils.ts` — bounded normalization helpers shared by source parsers
- `parsers/fixtures.ts` — sanitized parser fixtures shared by focused tests
- `parsers/amazon.ts` — pure Amazon order-confirmation parser
- `parsers/paypal.ts` — pure PayPal payment/order parser
- `parsers/parser-registry.ts` — source routing, deterministic receipt ownership, and public parser entry point
- `transaction-email-discovery.ts` — allowlisted Gmail historical-search adapter
- `transaction-import-store.ts` — durable run, item, claim, recovery, recent-run, and per-email status persistence; no mapping-table access
- `transaction-import-store-projections.ts` — database-row projections for durable runs and items, including historical captured targets/modes
- `transaction-import-planner-adapter.ts` — parser-candidate adaptation into the shared financial planner, planner-owned targets/rollout for new items, and redacted historical equivalence projection
- `transaction-import-equivalence-report.ts` — read-only historical replay and redacted gate summary
- `financial-email-preflight.ts` — stages exact generic USD expenses and transfer schedules, preserves their rollout mode, and applies expense preview outcomes and unattended eligibility
- `financial-email-transfer.ts` — shared payment identity across reminder emails, separate transfer preview/commit/recovery, durable attempt admission and schedule-aware outcomes
- `transaction-import-service.ts` — arrival preparation and historical-run admission
- `transaction-import-worker.ts` — resumable Gmail paging plus Actual preview/commit drains
- `transaction-import-arrivals.ts` — transient Gmail normalized-email adapter used by the non-blocking sync hook
- `transaction-import-runtime.ts` — bounded drain admission, startup stale recovery, and graceful shutdown

## Local patterns

- Parsers are pure: no configuration, persistence, logging, or network calls.
- Amounts are signed integer cents and dates are `YYYY-MM-DD`.
- Parser warnings carry an explicit `blocking` flag; automatic safety is projected centrally.
- New source-specific items use planner-inferred Actual targets and rollout eligibility; `candidate.transaction_import.executionOwner = "planner"` distinguishes them from historical items whose captured targets and modes remain intact. No live path reads legacy mapping configuration.
- Deterministic Amazon/PayPal receipts belong only to the source importer; generic staging checks that ownership first to avoid dual imported identities for one receipt.
- Transfer jobs share a stable identity for owner, source, destination, cents and date across reminder messages. Preview binds the Actual budget; a conditional persisted attempt marker admits one create call. Every later claim with that marker only reconciles, including manual retry and stale-claim recovery. Today/past notices without a match stay review. Transfers never enter expense import groups.
- Generic financial-email items never consult mappings. New enabled USD expenses enter automatic mode with `automatic_safe = 0`; only a would-add preview plus a previously passed current-Actual duplicate check and all plan gates can promote them to ready/automatic-safe. Existing observe-only items still require confirmation, and updates remain review-only.
- Planner no-write outcomes never enter generic preflight, including duplicates matched to existing Actual activity without a generic imported ID.
- Durable plan JSON must omit model/body evidence excerpts while retaining target provenance, reconciliation, and eligibility reasons.
- Raw Gmail message IDs remain distinct from RFC Message-ID headers.
- Raw bodies are transient input and must not cross persistence/status boundaries.
- Legacy `ea_transaction_import_mappings` rows remain untouched for audit/recovery only; retirement does not delete configuration or import history.

## Boundaries

- Gmail provider calls belong in `server/email/gmail.ts`; this domain validates options and adapts results.
- Actual Budget access belongs under `server/actual/`; parsers must never import it.
