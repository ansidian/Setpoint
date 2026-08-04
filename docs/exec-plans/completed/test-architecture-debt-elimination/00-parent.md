# Test Architecture Debt Elimination Program

**Status:** `complete`
**Opened:** 2026-08-02
**Manifest:** [`README.md`](README.md)

## Goal

Eliminate the remaining grandfathered test-architecture debt while preserving product-risk coverage. Every one of the current 272 project-local mock edges and 1,448 interaction assertions must be individually dispositioned as one of:

1. replaced by observable behavior or durable-state coverage;
2. deleted as duplicate or implementation-detail coverage after its behavior owner is verified; or
3. retained as a genuine outbound boundary contract with a narrow inline rationale beside the exact construct.

The terminal tracked baseline is empty. No aggregate allowance survives this program.

## Context

The completed behavior-remediation program established the correct doctrine and reduced the audit baseline from 458 local mock edges / 1,910 interaction assertions to 272 / 1,448. Its ratchet prevented regression but intentionally grandfathered the remainder. The owner has rejected grandfathering as an end state.

The starting baseline names 279 unique test files, 273 of which have at least one positive allowance. The manifest partitions every baseline key into disjoint path/behavior ownership so counts cannot be hidden by moving debt between children.

## Locked decisions

1. **Zero baseline, not zero testing boundaries.** `localModuleMocks` and `interactionAssertions` in the baseline must end empty. A true boundary construct may remain only with a reviewed inline exemption and evidence that an observable result is also asserted where possible.
2. **No bulk exemption migration.** A child may not mechanically annotate its existing counts. Each retained boundary assertion must name the outbound effect, why state observation is insufficient, and the behavior it protects.
3. **Requirements own tests.** No replacement test may be created solely to preserve case count, file adjacency, or coverage percentage.
4. **Behavior first, deletion second.** Before removing a unique case, identify the stable module/use-case owner and prove the behavior remains covered.
5. **Production seams may improve.** Small production refactors are allowed when needed to expose a stable facade or inject a true boundary. Do not add test-only production APIs or unrelated abstractions.
6. **Persistence is observable behavior.** Use migrated ephemeral databases for durable requirements; do not replace SQL-shape assertions with a different SQL mock.
7. **Pure algorithms remain legitimate owners.** Dense deterministic policy, parsing, recurrence, geometry, ordering, and state-machine matrices may keep direct input/output tests.
8. **Interaction assertions are exceptional.** Retain them for unavoidable outbound effects, concurrency admission, protocol framing, or negative safety contracts that cannot be established through state/result observation alone.
9. **No baseline increases or swaps.** A removed allowance cannot fund a new mock edge or interaction assertion elsewhere.
10. **One focused PR per child.** Children sharing a product surface are sequential as declared in the manifest.

## Scope ownership

| Child | Unique files | Mock files / edges | Interaction files / assertions |
| --- | ---: | ---: | ---: |
| 02 server core/HTTP/runtime | 28 | 20 / 42 | 21 / 157 |
| 03 server finance/providers | 18 | 7 / 16 | 15 / 71 |
| 04 server planning/state | 20 | 10 / 31 | 18 / 126 |
| 05 server communication/automation | 32 | 14 / 29 | 30 / 112 |
| 06 Calendar editor/actions | 16 | 4 / 4 | 16 / 118 |
| 07 Calendar workspace/views | 27 | 4 / 7 | 26 / 116 |
| 08 Calendar hooks | 13 | 2 / 2 | 13 / 139 |
| 09 Settings components | 25 | 22 / 38 | 25 / 128 |
| 10 app/auth/settings flows | 11 | 7 / 17 | 11 / 52 |
| 11 Inbox/Todoist UI | 22 | 13 / 21 | 18 / 117 |
| 12 Dashboard/bills UI | 19 | 13 / 46 | 16 / 57 |
| 13 remaining feature UI | 23 | 8 / 12 | 23 / 82 |
| 14 shared/hooks/lib/demo/API | 25 | 6 / 7 | 25 / 173 |
| **Total** | **279** | **130 / 272** | **257 / 1,448** |

## Per-child execution contract

1. Read the child, relevant area maps, `FLOWS.md`, and current baseline entries in the owned scope.
2. Record an exact starting inventory by file and requirement/behavior owner.
3. Classify each allowance: observable rewrite, duplicate deletion, stable pure contract, or genuine boundary.
4. Add or strengthen the stable behavior owner before deleting unique coverage.
5. Work in small behavior families; run focused tests after each family.
6. Remove every owned baseline entry. Inline boundary exemptions must meet the locked evidence standard.
7. Record cases/files/LOC and mock/interaction deltas, retained risks, and exact verification.

## Program acceptance criteria

- `scripts/lib/test-architecture-baseline.json` contains empty `localModuleMocks` and `interactionAssertions` objects, or is replaced by a zero-default policy with no grandfathered entries.
- The harness fails any new unexempted local module mock or interaction assertion; there is no approval path that silently recreates aggregate debt.
- Every retained inline exemption has been individually reviewed during its owning child and names a true boundary contract.
- No child loses unique security, authorization, redaction, durability, concurrency, retry, idempotency, migration, financial-write, provider-compatibility, accessibility, or browser-safety behavior.
- Primary tests survive internal refactors that preserve stable behavior.
- The final flow ledger maps critical `FLOWS.md` requirements to developer-test owners without hop-by-hop duplication.
- Complete Vitest and Playwright suites pass repeatedly without flakes.

## Non-goals

- No target for total test count, coverage percentage, or zero use of mocks in all tests.
- No rewriting stable pure input/output tests simply because they are narrow.
- No large product redesign or architecture rewrite unrelated to removing a specific test-coupling seam.
- No replacement of developer tests with a broad acceptance/E2E suite.

## Shared verification

- Focused tests for each changed behavior family.
- `npm run check:harness` and `npm run check:exports` for every child.
- `npm run typecheck`, `npm run typecheck:tools`, and `npm run lint`.
- `npm run test:fast`; add `npm run test:slow` for server, persistence, or filesystem work.
- `npm run build` for imported production or frontend changes.
- `git diff --check`.
- Child 15: three consecutive `npm test` runs and fully parallel `npm run test:e2e`.

## Closeout — 2026-08-03

The program closed with both aggregate baseline objects and both approval-ledger objects empty. All 272 starting local-module mock edges and 1,448 starting interaction assertions were replaced, deleted after owner verification, or retained only as individually reviewed construct-local boundary contracts. The final inventory is 590 test files / 4,192 source cases / 99,608 LOC, with 154 local-module boundary mocks and 397 boundary interactions carrying exact inline rationales. Child 15 records the boundary-kind counts, primary owner for every `FLOWS.md` flow, preserved risk contracts, and complete no-retry verification evidence.
