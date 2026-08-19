# Server Triage Map

AI email classification: the batch worker, model client, preflight rules, escalation policy, and eval harness. Entry point is `triage-worker.ts`, driven by `server/scheduler.ts`; it orchestrates across the email, snapshots, and bills domains.

## Files

- `triage-worker.ts` — batch triage of snapshot items, applies escalation policy
- `triage-types.ts` — shared triage rows, decisions, rules, model, queue, and dependency contracts
- `triage-projections-model.ts` — pure DB-free triage projections: bill candidate, event details, sound trigger, search text
- `triage-job-store.ts` — `ea_triage_jobs` queue SQL: claim/requeue/complete/defer/recover-stale/prune
- `triage-finalize-store.ts` — `ea_email_triage` + snapshot persistence: load email, update row, attach to snapshot
- `triage-model-client.ts` — LLM triage call and decision parsing
- `triage-decision-normalize.ts` — normalizes decisions: action, rationale, confidence
- `triage-heuristic-scorer.ts` — dev-only no-LLM classifier: sender/subject/body bands → lane (the `no_model` path)
- `triage-escalation-policy.ts` — routes actions to destinations (snooze/archive/bill/…)
- `triage-mode.ts` — triage mode config: auto/real/no-model/paused
- `triage-preflight.ts` — pre-triage checks: item availability, model readiness
- `triage-preflight-rules.json` — declarative preflight rule set
- `triage-cache-stats.ts` — token/cost stats for triage requests
- `triage-sound-settings.ts` — server-side triage sound preference storage
- `triage-eval.ts` — accuracy eval harness for the triage model
- `triage-worker.test-utils.ts` — shared triage worker test helpers

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Preflight rules are data (`triage-preflight-rules.json`), not code; edit the JSON and its test together.
- Escalation destinations live in `triage-escalation-policy.ts`; the worker never routes actions inline.

## Related

- `server/scheduler.ts` — cron entry (`processNextEmailTriageJob`)
- `server/snapshots/snapshot-triage-attachment.ts` — where decisions land on snapshot items
- `npm run triage:preflight` / `npm run triage:eval` — CLI harnesses in `server/scripts/`
