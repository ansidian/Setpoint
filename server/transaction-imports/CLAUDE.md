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
- `transaction-import-planner-adapter.ts` — parser-candidate adaptation into the shared financial planner plus redacted shadow-plan/equivalence projection
- `transaction-import-service.ts` — arrival preparation and historical-run admission
- `transaction-import-worker.ts` — resumable Gmail paging plus Actual preview/commit drains
- `transaction-import-arrivals.ts` — transient Gmail normalized-email adapter used by the non-blocking sync hook
- `transaction-import-runtime.ts` — bounded drain admission, startup stale recovery, and graceful shutdown

## Local patterns

- Parsers are pure: no configuration, persistence, logging, or network calls.
- Amounts are signed integer cents and dates are `YYYY-MM-DD`.
- Parser warnings carry an explicit `blocking` flag; automatic safety is projected centrally.
- Financial plans are shadow evidence until the documented equivalence gate passes; legacy mapped targets and modes remain authoritative during that phase.
- Durable plan JSON must omit model/body evidence excerpts while retaining target provenance, reconciliation, and eligibility reasons.
- Raw Gmail message IDs remain distinct from RFC Message-ID headers.
- Raw bodies are transient input and must not cross persistence/status boundaries.

## Boundaries

- Gmail provider calls belong in `server/email/gmail.ts`; this domain validates options and adapts results.
- Actual Budget access belongs under `server/actual/`; parsers must never import it.
