# Financial connections

Canonical, budget-bound owner configuration for provider automation, utility display identities, and schedule payment links. This domain never writes to Actual.

- `service.ts` — public read/atomic-save facade, field and Actual-target validation, budget/revision conflict protection.
- `storage.ts` — canonical configuration reads and re-exports of shared projections; read-only legacy fallback exists only before explicit migration or for older offline schema snapshots. Once canonical state exists, archived configuration is never read as runtime fallback.
- `migration.ts` — public read-only migration preview and explicit fingerprint-guarded atomic apply; legacy records remain audit history.

`ea_financial_connection_state` owns one revision per owner; `ea_financial_connections` holds budget-bound entries. Parser recognition comes from the shared provider catalog. Automation authority remains a saved enabled typed target. Unsupported entries and schedule-only links cannot grant authority. Utilities retain their stable IDs; pay links attach to exact schedules. GETs never migrate. The migration CLI does not activate parser processing.
