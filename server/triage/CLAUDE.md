# Server Triage Map

AI email classification: the batch worker, model client, preflight rules, escalation policy, and eval harness. Entry point is `triage-worker.ts`, driven by `server/scheduler.ts`; it orchestrates across the email, snapshots, and bills domains.

## Files

- `triage-worker.ts` — batch triage of snapshot items and escalation policy; persists the triage financial candidate without planning or staging it
- `triage-types.ts` — shared triage rows, decisions, rules, model, queue, and dependency contracts
- `triage-projections-model.ts` — pure DB-free triage projections: email interests, event details, and sound trigger
- `triage-job-store.ts` — `ea_triage_jobs` queue SQL: claim/requeue/complete/defer/recover-stale/prune
- `triage-finalize-store.ts` — `ea_email_triage` + snapshot persistence: load email, persist decisions/candidates (historical financial plans are left untouched), attach to snapshot
- `triage-model-client.ts` — LLM triage call and decision parsing; records each provider attempt before semantic parsing, owns financial candidate admission, and embeds the bills domain's shared first-pass semantic instructions
- `fixtures/financial-admission.json` — paired fictional fulfillment, purchase, return, refund and incomplete-bill sources with financial-admission labels for deterministic provider-parser tests
- `triage-decision-normalize.ts` — normalizes decisions: action, rationale, confidence
- `triage-heuristic-scorer.ts` — dev-only no-LLM classifier: sender/subject/body bands → lane (the `no_model` path)
- `triage-escalation-policy.ts` — routes actions to destinations (snooze/archive/bill/…)
- `triage-mode.ts` — triage mode config: auto/real/no-model/paused
- `triage-preflight.ts` — pre-triage checks: item availability, model readiness
- `triage-preflight-rules.json` — declarative preflight rule set
- `triage-cache-stats.ts` — token/cost stats for triage requests
- `triage-sound-settings.ts` — server-side triage sound preference storage
- `triage-eval.ts` — accuracy eval harness for the triage model; tags calls to bypass usage recording and requires the owner via `EA_USER_ID` or `accountingUserId` for model settings, never fixture identity
- `triage-worker.test-utils.ts` — shared triage worker test helpers

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Preflight rules are data (`triage-preflight-rules.json`), not code; edit the JSON and its test together. Financial-event profiles route to semantic classification; finalization never manufactures candidates from monetary keywords.
- Escalation destinations live in `triage-escalation-policy.ts`; the worker never routes actions inline.

## Related

- `server/scheduler.ts` — cron entry (`processNextEmailTriageJob`)
- `server/snapshots/snapshot-triage-attachment.ts` — where decisions land on snapshot items
- `npm run triage:preflight` / `npm run triage:eval` — CLI harnesses in `server/scripts/`
