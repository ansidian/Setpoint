# Finances workspace

Read-only Utilities and Journal composition from managed financial-event statements and Actual. No module here writes to Actual or admits automation.

- `finance-workspace.ts` — bounded saved-source, activity, bill mirror and Actual Journal composition
- `finance-statement-model.ts` — source-grounded statement facts and exact occurrence payment links

Utility membership is persisted against one exact Actual budget and payee. Never infer membership on reads from a provider name. Workspace GETs read managed statement evidence and never extract, sync or write. Missing evidence remains unavailable.
