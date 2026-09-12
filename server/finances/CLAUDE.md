# Finances workspace

Payments and Journal composition from managed financial-event statements and Actual, with Setpoint-owned display organization. No module here writes to Actual or admits automation.

- `finance-workspace.ts` — bounded saved-source, activity, bill mirror and Actual Journal composition
- `finance-statement-model.ts` — source-grounded statement facts and exact occurrence payment links
- `finance-statement-sources.ts` — first original bill source per managed event, immutable settled candidates, complete saved email/PDF evidence, and budget-bound utility membership
- `recurring-statement-sources.ts` — source-only card statement balances and due dates linked through exact saved schedule evidence or explicit validated card profiles
- `utility-mappings.ts` — validates and updates existing budget-bound utility payee/schedule membership; never writes Actual or changes source evidence
- `payment-groups.ts` — budget-scoped display organization with atomic revision checks; GETs derive starter layouts without writing
- `payment-catalog.ts` — stable utility and schedule identities across months, with card identity grounded in saved profiles or statement evidence

Utility membership is persisted against one exact Actual budget and payee. Never infer membership on reads from a provider name. Workspace GETs read managed statement evidence and never extract, sync or write. Missing evidence remains unavailable.
