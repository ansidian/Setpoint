# Server Triage Map

AI email classification: the batch worker, model client, preflight rules, escalation policy, and eval harness. Entry point is `triage-worker.js`, driven by `server/scheduler.js`; it orchestrates across the email, snapshots, and bills domains.

## Files

- `triage-worker.js` — batch triage of snapshot items, applies escalation policy
- `triage-projections-model.js` — pure DB-free triage projections: bill candidate, event details, sound trigger, search text
- `triage-job-store.js` — `ea_triage_jobs` queue SQL: claim/requeue/complete/defer/recover-stale/prune
- `triage-finalize-store.js` — `ea_email_triage` + snapshot persistence: load email, update row, attach to snapshot, weak-security grace defer
- `triage-model-client.js` — LLM triage call and decision parsing
- `triage-decision-normalize.js` — normalizes decisions: action, rationale, confidence
- `triage-heuristic-scorer.js` — dev-only no-LLM classifier: sender/subject/body bands → lane (the `no_model` path)
- `triage-escalation-policy.js` — routes actions to destinations (snooze/archive/bill/…)
- `triage-mode.js` — triage mode config: auto/real/no-model/paused
- `triage-preflight.js` — pre-triage checks: item availability, model readiness
- `triage-preflight-rules.json` — declarative preflight rule set
- `triage-cache-stats.js` — token/cost stats for triage requests
- `triage-sound-settings.js` — server-side triage sound preference storage
- `triage-eval.js` — accuracy eval harness for the triage model
- `triage-worker.test-utils.js` — shared triage worker test helpers

(Tests are not listed: `X.test.js(x)` covers `X` by convention; the worker is covered by a family of `triage-worker.<aspect>.test.js(x)` files.)

## Local patterns

- Preflight rules are data (`triage-preflight-rules.json`), not code; edit the JSON and its test together.
- Escalation destinations live in `triage-escalation-policy.js`; the worker never routes actions inline.

## Related

- `server/scheduler.js` — cron entry (`processNextEmailTriageJob`)
- `server/snapshots/snapshot-triage-attachment.js` — where decisions land on snapshot items
- `npm run triage:preflight` / `npm run triage:eval` — CLI harnesses in `server/scripts/`
