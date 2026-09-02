# Transaction Import Domain Map

Deterministic Gmail email-to-transaction parsing and bounded historical discovery. This domain emits normalized candidates; durable orchestration and Actual writes remain separate concerns.

## Files

- `transaction-import-types.ts` — parser, candidate, evidence, warning, and automatic-safety contracts
- `parsers/parser-utils.ts` — bounded normalization helpers shared by source parsers
- `parsers/fixtures.ts` — sanitized parser fixtures shared by focused tests
- `parsers/amazon.ts` — pure Amazon order-confirmation parser
- `parsers/paypal.ts` — pure PayPal payment/order parser
- `parsers/parser-registry.ts` — source routing and public parser entry point
- `transaction-email-discovery.ts` — allowlisted Gmail historical-search adapter
- `transaction-import-store.ts` — durable mapping, run, item, claim, recovery, recent-run, and per-email status persistence
- `transaction-import-store-projections.ts` — database-row projections for durable mappings, runs, and items
- `transaction-import-planner-adapter.ts` — parser-candidate adaptation into the shared financial planner plus redacted shadow-plan/equivalence projection
- `transaction-import-equivalence-report.ts` — read-only historical replay and redacted gate summary
- `financial-email-preflight.ts` — projects exact generic one-time expenses into stable observe-only items and applies Actual dry-run outcomes back to their plans
- `transaction-import-service.ts` — arrival preparation and historical-run admission
- `transaction-import-worker.ts` — resumable Gmail paging plus Actual preview/commit drains
- `transaction-import-arrivals.ts` — transient Gmail normalized-email adapter used by the non-blocking sync hook
- `transaction-import-runtime.ts` — bounded drain admission, startup stale recovery, and graceful shutdown

## Local patterns

- Parsers are pure: no configuration, persistence, logging, or network calls.
- Amounts are signed integer cents and dates are `YYYY-MM-DD`.
- Parser warnings carry an explicit `blocking` flag; automatic safety is projected centrally.
- Financial plans are shadow evidence until the documented equivalence gate passes; legacy mapped targets and modes remain authoritative during that phase.
- Generic financial-email items have no mapping or automatic mode: they enter observe-only with `automatic_safe = 0`, use the stable plan identity as imported ID, and require explicit owner confirmation after preview.
- Planner no-write outcomes never enter generic preflight, including duplicates matched to existing Actual activity without a generic imported ID.
- Durable plan JSON must omit model/body evidence excerpts while retaining target provenance, reconciliation, and eligibility reasons.
- Raw Gmail message IDs remain distinct from RFC Message-ID headers.
- Raw bodies are transient input and must not cross persistence/status boundaries.

## Boundaries

- Gmail provider calls belong in `server/email/gmail.ts`; this domain validates options and adapts results.
- Actual Budget access belongs under `server/actual/`; parsers must never import it.
