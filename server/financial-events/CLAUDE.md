# Financial Events Map

Durable autonomous accounting for new email arrivals. Documents supply authenticated source facts; related documents describe one financial event. Inbox presentation never owns this queue. Migration 062 establishes the new-arrivals cutoff without enrolling historical mail.

## Files

- `financial-event-service.ts` — public bounded worker; independently assesses complete documents, collects related evidence, plans against Actual, admits an immutable operation, and recovers uncertain writes without dispatching again
- `financial-event-intake.ts` — public durable Gmail forward capture; fixed post-cutoff windows, strict page completion, outage/restart recovery and capture completeness before event admission
- `financial-event-store.ts` — atomic revision/claim persistence, permanent reference aliases, source-to-event association, operation admission, retry deadlines and status reads
- `financial-event-evidence.ts` — source hashes and grounded reference keys, conservative complementary receipt matching, compatible fact bundles and conflict detection
- `financial-event-operation.ts` — maps a plan to existing SDK facades, binds the previewed budget and schedule fingerprint, and projects verified operation outcomes
- `financial-event-status.ts` — public read-only ownership and live status facade; managed-email reads never trigger the historical planner or another write path
- `financial-event-completion.ts` — public owner-confirmation use case; validates current managed-source revisions and queues the same event without writing to Actual
- `financial-event-completion-model.ts` — confirmed-entry validation, immutable source snapshots, compatible later-evidence checks and exact operation construction

## Contracts

- All new indexed arrivals after the migration cutoff are assessed independently of read/dismiss/snooze and Inbox triage admission. Gmail forward acquisition also captures received mail outside Inbox; iCloud retains its configured Inbox scope.
- Classification uses the configured strong email model and honors paused/disabled email AI. Failed verification, contradictory purpose and unsupported dates receive bounded full-source reassessment before caching. Unchanged successful content reuses its assessment; source/authentication revisions invalidate stale work. A negative assessment is explicit and durable. Planning retains complete authenticated bodies, rejecting combined evidence beyond the existing decision limit visibly.
- Authenticated, complementary receipt roles can join only with exact merchant/amount/currency/date, a five-minute arrival interval and unique matches in both directions. Same amount/date alone cannot establish identity. Permanent reference aliases survive bounded correlation history and source changes.
- Missing source facts/authentication retry automatically. Conflicting current Actual identity requires attention. Before first dispatch, the exact budget-bound payload and attempt are stored atomically. Every later claim is recovery-only, including after new evidence or a crash.
- Production access goes through `server/actual/actual.ts`. Tests write only to disposable databases/budgets. New managed messages cannot also enter legacy parser or generic preflight paths.
- Status exposes pending, waiting, settled and needs-review states plus related-email count and retry time. The legacy import tables and historical observe modes remain unchanged.
- Owner completion supplies missing facts explicitly and can run while email AI is paused. It preserves original source evidence, invalidates stale automation claims and retains the same capture/coalescing and immutable Actual admission/recovery path. Fresh revisions permit corrections only before admission while waiting or needing review; an attempted entry cannot be resubmitted. Later related receipts use a separate owner-confirmed identity projection and must have compatible account evidence. Source changes remain visible across restarts and authentication refreshes.

Tests follow the stable-owner policy in `AGENTS.md`; full worker replays keep the store, evidence, planner and operation adapter together while replacing external AI/Actual boundaries.
