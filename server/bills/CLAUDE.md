# Server Bills Map

Bill domain logic: AI extraction from emails, zero-configuration financial-email planning, and the bills mirror. Entry point is `bills-service.ts`, which drives the `server/actual/` engine layer and owns Actual-metadata invalidation fan-out on writes.

## Files

- `bills-service.ts` — public bills API; owns Actual-metadata invalidation fan-out on writes
- `bill-extract.ts` — supplies complete bounded semantic email evidence for financial extraction; rejects incomplete source bodies
- `bill-extraction-service.ts` — owns candidate-only LLM extraction/verification for the financial-email planner
- `bill-semantic-prompt.ts` — public bills-domain entry that owns first-pass bill-semantic extraction instructions shared by email triage and manual extraction
- `bill-extractors/catalog.ts` — bill-extraction defaults and validation facade over the centralized AI model catalog
- `bill-extractors/anthropic.ts` — Claude tool-use extraction call; records provider usage before field parsing
- `bill-extractors/openai.ts` — OpenAI structured-JSON extraction call; records provider usage before field parsing
- `billAmountVerifier.ts` — bounded second-pass LLM audit for incomplete amount coverage or ungrounded/conflicting monetary labels; failed audits block canonical selection
- `billEventVerifier.ts` — bounded second-pass LLM audit for uncertain events or missing payment purpose, with source-grounded type/account evidence and persisted attempt markers
- `bill-candidate-verification-service.ts` — public bills-domain facade for semantic amount and event verification of email candidates
- `financial-email-planner.ts` — zero-configuration financial-email contract seam; classifies purpose, preserves intended versus final operation, derives stable identity, adapts reconciliation, and never writes or persists
- `financial-email-adoption-service.ts` — live read/persistence facade; refreshes historical plans once for newer target inference, stronger authentication, or bounded missing-purpose verification, compare-and-swap persists the winner, and stages exact expense preflight without promoting stored observe-only plans
- `financial-email-evaluator.ts` — write-disabled redacted comparison of the planner result with a supplied legacy resolution
- `financial-email-observe-report.ts` — bounded, read-only aggregation of persisted planner outcomes by automation operation class; never executes writes
- `financialEmailClassificationPolicy.ts` — validates source-grounded semantic identity and classifies document/intent independently of resolved Actual targets; ambiguous payment purposes stay review
- `financialEmailAutomationPolicy.ts` — fail-closed automation gates and operation-class rollout policy; one-time expenses, income transactions, and transfer schedules are enabled; utility schedules remain observe-only
- `financialEmailIdentity.ts` — one-way, versioned stable identity derived from owner, provider account, provider message, and optional candidate hint
- `financialEmailSourceIdentity.ts` — validates normalized email authentication projections and adapts them into planner source identity
- `financialEmailTargetInference.ts` — Package 2 deterministic Actual target inference from metadata, schedules, and bounded direction-aware history; returns provenance and competing candidates
- `financialEmailAccountEvidence.ts` — exact card-product identity, constrained existing-account ranking, and signed schedule topology for transfer targets; never guesses a funding account
- `financialEmailImportedHistory.ts` — exact imported-ID target evidence projected from Actual transaction history
- `financialEmailMerchantCandidates.ts` — bounded generic merchant similarity retrieval over real Actual payees plus repeated direction/account-compatible history; discovery never selects a target
- `financialEmailRewardEvidence.ts` — owner-approved Cashback interpretation plus evidence-gated payee/category and settlement-account discovery; ambiguous Actual evidence remains unresolved
- `financialEmailTargetRanker.ts` — constrained external-provider adapter that can select only supplied opaque history-bundle keys with high-confidence verbatim evidence
- `billSemanticAmountPolicy.ts` — canonical semantic amount selection for the planner; minimum due is never operational
- `statementActualStatusModel.ts` — strict pure matcher for statement candidates against Actual schedules, occurrences, and exact transactions
- `bills-mirror-sync.ts` — syncs bill occurrences into `ea_bills_mirror_*`, schedules maintenance; thin IO + scheduler + refresh-orchestration over billsMirrorModel.ts
- `billsMirrorModel.ts` — pure derivation: date/range math, mirror row<->object projections, upsert arg builders, and the maintenance-due predicate
- `bills-mirror-refresh-policy.ts` — pure guard: should a reader kick an immediate mirror refresh, or is a settle window already armed

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Bills write through `server/actual/actual.ts`; this domain decides *what* to write, the actual domain decides *how*.
- Extraction providers are registered in `bill-extractors/catalog.ts`; add new providers there, not inline.
- Provider adapters record actual extraction/verification/matching attempts. Scoped AI usage context preserves the triggering origin and evaluation status through planning; deterministic repairs and cached plan reuse create no usage events.

## Related

- `server/actual/` — engine layer this domain drives
- `server/routes/briefing/bills.ts` — HTTP surface
- `FLOWS.md` — bill-pay/Actual sync flow, hop by hop
