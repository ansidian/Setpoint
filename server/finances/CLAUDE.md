# Finances workspace

Read-only Utilities and Journal composition from managed financial-event statements and Actual. No module here writes to Actual or admits automation.

- `finance-workspace.ts` — bounded saved-source, activity, bill mirror and Actual Journal composition
- `finance-statement-model.ts` — source-grounded statement facts and exact occurrence payment links
- `finance-statement-sources.ts` — first original bill source per managed event, immutable settled candidates, complete saved email/PDF evidence, and budget-bound utility membership
- `utility-mappings.ts` — validates and updates existing budget-bound utility payee/schedule membership; never writes Actual or changes source evidence

Utility membership is persisted against one exact Actual budget and payee. Never infer membership on reads from a provider name. Workspace GETs read managed statement evidence and never extract, sync or write. Missing evidence remains unavailable.
