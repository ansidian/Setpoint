# 15 — Zero-Baseline Certification

**Parent:** [`00-parent.md`](00-parent.md)
**Status:** `complete`
**Depends on:** 02–14

## Goal

Prove that every grandfathered allowance has been dispositioned, remove the aggregate debt baseline, recertify critical flows and high-risk contracts, and close the program with repeatable evidence.

## Starting target

- 272 local mock edges → 0 grandfathered entries.
- 1,448 interaction assertions → 0 grandfathered entries.
- 279 uniquely owned starting baseline keys reviewed by children 02–14 (273 files carry a positive allowance).

## Scope

- Recompute raw local mocks, interaction assertions, inline exemptions, files/cases/LOC, and test runtime.
- Audit every retained inline exemption for a named true boundary, local rationale, and paired observable result where possible.
- Verify every current `FLOWS.md` flow has one primary developer-test owner and no required behavior was lost.
- Replace the populated baseline with an empty zero-default baseline or equivalent no-grandfathering policy.
- Update `AGENTS.md`, maps, quality docs, and plan notes only where final reality differs.

## Locked decisions

- A non-empty baseline is a closeout blocker, regardless of aggregate reduction.
- Bulk or generic exemption text is a closeout blocker.
- Removed high-risk behavior is a closeout blocker even if all counts reach zero.
- Flakes, retries, or “passes in isolation” are closeout blockers until diagnosed or explicitly owner-accepted.

## Acceptance criteria

- Baseline objects are empty or deleted in favor of a policy whose default allowance is zero.
- The approval ledger is empty.
- Every inline exemption passes manual and mechanical review; final report lists counts by boundary kind.
- Security, authorization, redaction, durability, concurrency, retry, idempotency, migration, financial-write, provider compatibility, accessibility, demo safety, and browser-only contracts remain mapped and passing.
- Three consecutive `npm test` runs pass without retry.
- `npm run test:e2e` passes fully parallel without retry.
- Typechecks, lint, build, harness, exports/reachability, fast/slow partitions, and whitespace checks pass.
- Parent and manifest move together to `docs/exec-plans/completed/test-architecture-debt-elimination/` with final metrics and risks.

## Verification

- `npm run check:harness`, `npm run check:exports`, `npm run check:reachability`.
- `npm run typecheck`, `npm run typecheck:tools`, `npm run lint`, `npm run build`.
- `npm run test:fast`, `npm run test:slow`.
- Three consecutive `npm test` runs.
- Fully parallel `npm run test:e2e`.
- `git diff --check`.

## Non-goals

- No claim that all mocks or interaction assertions are inherently invalid; the goal is zero unreviewed/grandfathered debt.

## Starting inventory — 2026-08-03

Recomputed directly from `scripts/lib/test-architecture-baseline.json` before closeout edits:

- Baseline-key files: 0.
- Grandfathered local-module mock edges: 0.
- Grandfathered interaction assertions: 0.
- Approval-ledger entries: 0.

The selected child starts with no owned allowance entry because children 02–14 already removed every program-owned key. Child 15 owns the independent certification of the original 279-key / 272-mock / 1,448-interaction program inventory, the retained-boundary audit, the flow-owner ledger, and final program closure.

## Certification decisions

- The aggregate baseline and approval ledger remain present as explicit zero-default policy files, both with empty allowance objects. The harness now rejects any future aggregate entry unconditionally; construct-local boundary rationales are the only permitted exception mechanism.
- `calendar-google-client` credential/reauth tests and `bills-mirror-sync` projection/schedule tests now execute against migrated ephemeral libSQL databases. Their former database-module mocks and SQL/call-shape assertions were removed in favor of durable rows and returned projections.
- Todoist mirror/default/task-mutation tests execute the real reminder collaborator against migrated ephemeral databases. Task mutation production options inject only the real database and outbound cleanup/recompute boundaries; no test-only API was added.
- Flow gaps found during certification received authoritative coverage: bills SSE invalidates warmed Actual metadata; Calendar modifier selection works on both visible overflow surfaces and with bare Meta/Control; and a selected OpenAI provider with missing OpenAI credentials does not fall back to configured Anthropic.
- `FLOWS.md` now places Calendar multi-selection state under Flow 5 and documents the shipped transaction-import UI under Flow 12.

## Exact retained-boundary ledger

The mechanical and manual audit found 551 executable, construct-local exemptions in 142 files: 154 local-module boundary mocks and 397 boundary interactions. Every exemption is the adjacent source comment beginning `test-architecture: allow-boundary-*`; those comments are the authoritative per-construct record and state why result/state observation is insufficient. The reproducible exact inventory is:

```sh
rg -n 'test-architecture: allow-boundary-(mock|interaction) --' \
  -g '*.test.ts' -g '*.test.tsx' -g '*.spec.ts' -g '*.spec.tsx' \
  --glob '!scripts/lib/test-architecture-policy.test.mts'
```

Policy-fixture marker strings are excluded because they are not executable comments. TypeScript-AST harness collection independently confirmed zero empty, detached, shared, or unexempted constructs.

| Boundary kind | Mocks | Interactions | Total | Why result/state is insufficient |
| --- | ---: | ---: | ---: | --- |
| Outbound provider/network/credential protocol | 92 | 258 | 350 | Returned UI/service state cannot prove exact external payloads, negative writes, protocol order, redaction, compatibility keys, or credential isolation. |
| Process, worker, scheduler, timer, or clock | 14 | 69 | 83 | Settled results cannot expose admission count/order, drain behavior, retry timing, coalescing, or negative background work. |
| Database or independently durable storage | 35 | 21 | 56 | The consuming facade cannot choose a singleton's physical store or prove an exact cross-domain durable mutation when that persistence owner is separately exercised with migrations. |
| Browser/platform | 8 | 44 | 52 | Successful navigation, reload, clipboard, WebAuthn, focus/scroll, media, or page-exit effects replace or leave the current document with no observable post-effect state. |
| Filesystem or provider-owned storage | 5 | 5 | 10 | In-memory results cannot prove file selection, provider storage isolation, lock behavior, or exact disk/process handoff. |
| **Total** | **154** | **397** | **551** | No aggregate allowance; every construct carries its own narrower rationale. |

The certification specifically re-reviewed module names that could be mistaken for internal seams. Todoist mirrors, active snapshots, task history, tombstones, reminders, Actual lightweight-wire/forked workers, and provider-local metadata were retained only where the consuming facade reads an independently durable provider/domain or crosses a process/filesystem boundary already owned by migrated persistence or provider-protocol tests. Calendar credentials, bills mirror persistence, and task reminder composition did not meet that bar and were rewritten.

## Primary flow-owner ledger

| `FLOWS.md` flow | Primary developer-test owner | Preserved contract/risk |
| --- | --- | --- |
| 1. Bills write to dashboard | `server/bills/bills-service.test.ts` plus `src/hooks/useCurrentDashboard.events.test.ts` for joined SSE/cache behavior | Financial write, deferred refresh, cache invalidation, provider fallback |
| 2. Gmail push to inbox | `server/email/gmail-sync.test.ts` | Authorization, provider compatibility, retry/idempotent sync |
| 3. Briefing to historical snapshot | `server/snapshots/snapshot-service.test.ts` | Durable snapshot identity, redaction, historical immutability |
| 4. Calendar search | `src/components/calendar/CalendarModal.search-workflow.test.tsx` | Search/range admission, stale-result safety, rendered selection |
| 5. Calendar multi-selection | `src/components/calendar/CalendarModal.events.test.tsx` | Modifier semantics, overflow surfaces, keyboard/browser safety |
| 6. Graceful shutdown | `server/shutdown.test.ts` | Drain ordering, bounded exit, stale-work recovery |
| 7. First-run owner claim | `server/routes/auth.test.ts` | Singleton authorization claim, bootstrap/session safety |
| 8. Security transition | `server/routes/auth.test.ts` with passkey ceremony support in `server/routes/auth.passkeys.test.ts` | Step-up authorization, passkeys, recovery/redaction |
| 9. Todoist OAuth | `server/routes/todoist-oauth.test.ts` | State/token security, webhook/provider compatibility |
| 10. Capability status | `server/capability-status-service.test.ts` | Credential redaction, cache/health projection |
| 11. Onboarding progress | `server/onboarding-progress-store.test.ts` | Durable progress and authenticated projection |
| 12. Transaction import | `server/transaction-imports/transaction-import-worker.test.ts` | Migration, idempotency, financial write, retry/durable review state |
| 13. Alfred provider run | `server/routes/alfred.test.ts` | Conversation binding, credential isolation, no cross-provider fallback |

## Final metrics

| Metric | Program start | Certified end |
| --- | ---: | ---: |
| Whole test inventory files | 596 | 590 |
| Whole test inventory source cases | 4,273 | 4,192 |
| Whole test inventory LOC | 103,207 | 99,608 |
| Starting-baseline owned files | 279 | 271 surviving test files; 0 baseline-key files |
| Starting-baseline owned cases | 1,961 | 1,875 |
| Starting-baseline owned LOC | 60,770 | 57,428 |
| Raw local-module mock constructs | 320 | 154, all individually exempted |
| Raw interaction assertions | 1,512 | 397, all individually exempted |
| Grandfathered local-module mock edges | 272 | 0 |
| Grandfathered interaction assertions | 1,448 | 0 |
| Approval-ledger entries | 0 | 0 |

The ending Vitest run executes 590 files / 4,283 tests; source-case inventory is lower because parameterized/generated cases expand at runtime.

## Verification evidence — 2026-08-03

- Focused certification families: 12 files / 119 tests passed.
- `npm run check:harness`: passed; zero baseline and approval entries, zero unexempted constructs, and all inline rationales construct-local.
- `npm run check:exports`: passed; 0 unexpected / 0 stale exemptions.
- `npm run check:reachability`: passed; 0 candidate unreachable, test-only target, unresolved internal edge, missing entrypoint, or stale exemption.
- `npm run typecheck`, `npm run typecheck:tools`, `npm run lint`, and `npm run build`: passed.
- `npm run test:fast`: 577 files / 4,192 tests passed.
- `npm run test:slow`: 13 files / 91 tests passed.
- Three consecutive `npm test` runs: 590 files / 4,283 tests passed without retry in 56.89s, 56.83s, and 59.24s.
- Fully parallel `npm run test:e2e`: 18 tests passed with six workers; local retry count was zero.
- `git diff --check`: passed before closeout; repeated after status/move edits.

Remaining program totals are 0 baseline-key files / 0 grandfathered mocks / 0 grandfathered interactions. There is no next eligible child; child 15 closes the program.
