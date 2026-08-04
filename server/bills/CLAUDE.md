# Server Bills Map

Bill domain logic: AI extraction from emails, user bill-matching rules, and the bills mirror. Entry point is `bills-service.ts`, which drives the `server/actual/` engine layer and owns Actual-metadata invalidation fan-out on writes.

## Files

- `bills-service.ts` — public bills API; owns Actual-metadata invalidation fan-out on writes
- `bill-extract.ts` — trims HTML email bodies to payee/amount/date context for AI
- `bill-extraction-service.ts` — runs the LLM extractor, resolves category/account IDs
- `bill-extractors/catalog.ts` — bill-extraction defaults and validation facade over the centralized AI model catalog
- `bill-extractors/anthropic.ts` — Claude tool-use extraction call
- `bill-extractors/openai.ts` — OpenAI structured-JSON extraction call
- `bill-pay-mappings.ts` — schema for user bill-matching rules (profiles, behaviors, targets)
- `bill-pay-resolver.ts` — applies mappings to extracted/pasted bills: amounts, dates
- `bill-pay-service.ts` — loads mappings + Actual projections, resolves bills against user rules, and attaches canonical reconciliation status
- `statementActualStatusModel.ts` — strict pure matcher for statement candidates against Actual schedules, occurrences, and exact transactions
- `bills-mirror-sync.ts` — syncs bill occurrences into `ea_bills_mirror_*`, schedules maintenance; thin IO + scheduler + refresh-orchestration over billsMirrorModel.ts
- `billsMirrorModel.ts` — pure derivation: date/range math, mirror row<->object projections, upsert arg builders, and the maintenance-due predicate
- `bills-mirror-refresh-policy.ts` — pure guard: should a reader kick an immediate mirror refresh, or is a settle window already armed

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Bills write through `server/actual/actual.ts`; this domain decides *what* to write, the actual domain decides *how*.
- Extraction providers are registered in `bill-extractors/catalog.ts`; add new providers there, not inline.

## Related

- `server/actual/` — engine layer this domain drives
- `server/routes/briefing/bills.ts` — HTTP surface
- `FLOWS.md` — bill-pay/Actual sync flow, hop by hop
