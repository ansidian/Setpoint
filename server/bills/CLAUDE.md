# Server Bills Map

Bill domain logic: AI extraction from emails, user bill-matching rules, and the bills mirror. Entry point is `bills-service.ts`, which drives the `server/actual/` engine layer and owns Actual-metadata invalidation fan-out on writes.

## Files

- `bills-service.ts` — public bills API; owns Actual-metadata invalidation fan-out on writes
- `bill-extract.ts` — trims HTML email bodies to payee/amount/date context for AI
- `bill-extraction-service.ts` — owns candidate-only LLM extraction/verification and the compatibility path that resolves extracted candidates
- `bill-semantic-prompt.ts` — public bills-domain entry that owns first-pass bill-semantic extraction instructions shared by email triage and manual extraction
- `bill-extractors/catalog.ts` — bill-extraction defaults and validation facade over the centralized AI model catalog
- `bill-extractors/anthropic.ts` — Claude tool-use extraction call
- `bill-extractors/openai.ts` — OpenAI structured-JSON extraction call
- `bill-pay-mappings.ts` — retained legacy mapping schema for the second Package 6 retirement slice; no public Settings or Mapping Test path remains
- `bill-pay-resolver.ts` — applies deterministic identity, semantic event/amount policy, and owner-approved targets; fails closed on missing evidence
- `billSemanticEventPolicy.ts` — pure event-to-operational-policy selector; fails closed on distinct compatible target sets
- `billTargetPolicySelector.ts` — bounded LLM chooser for supplied opaque target-policy keys when semantic routing remains ambiguous
- `bill-semantic-resolution.ts` — single semantic resolution orchestration with bounded candidate and target verification
- `billAmountVerifier.ts` — bounded second-pass LLM audit for incomplete multi-amount candidate coverage
- `billEventVerifier.ts` — bounded second-pass LLM audit for low-confidence or `other` semantic events
- `bill-candidate-verification-service.ts` — public bills-domain facade for semantic amount and event verification of email candidates
- `financial-email-planner.ts` — zero-configuration financial-email contract seam; classifies purpose, preserves intended versus final operation, derives stable identity, adapts reconciliation, and never writes or persists
- `financial-email-adoption-service.ts` — live read/persistence facade; reuses stored plans and compare-and-swap persists one plan for historical candidates
- `financial-email-evaluator.ts` — write-disabled redacted comparison of the planner result with a supplied legacy resolution
- `financial-email-observe-report.ts` — bounded, read-only aggregation of persisted planner outcomes by automation operation class; never executes writes
- `financialEmailClassificationPolicy.ts` — pure semantic-event to document/intent classification policy used by the planner
- `financialEmailAutomationPolicy.ts` — fail-closed automation gates and operation-class rollout policy; every class currently remains observe-only
- `financialEmailIdentity.ts` — one-way, versioned stable identity derived from owner, provider account, provider message, and optional candidate hint
- `financialEmailTargetInference.ts` — Package 2 deterministic Actual target inference from metadata, schedules, and bounded direction-aware history; returns provenance and competing candidates
- `financialEmailImportedHistory.ts` — exact imported-ID target evidence projected from Actual transaction history
- `financialEmailTargetRanker.ts` — constrained external-provider adapter that can select only supplied opaque history-bundle keys with high-confidence verbatim evidence
- `billSemanticAmountPolicy.ts` — canonical semantic amount selection shared by the planner and legacy resolver; minimum due is never operational
- `bill-pay-service.ts` — retained internal legacy resolver for the second Package 6 retirement slice; no public Settings or Mapping Test path remains
- `billSemanticHealthTelemetry.ts` — emits redacted semantic-resolution health with one-way email fingerprinting
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
