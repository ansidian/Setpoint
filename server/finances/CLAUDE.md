# Finances workspace

Read-only Payments and Journal composition from Actual, with Setpoint-owned display organization. Nothing here writes to Actual.

- `finance-workspace.ts` — bounded Actual schedule mirror, metadata and Journal composition
- `occurrence-payments.ts` — recovers exact payment IDs for older retained paid occurrences from unambiguous schedule postings
- `payment-groups.ts` — budget-scoped display organization with atomic revision checks; GETs derive starter layouts without writing and drop retired utility identities from saved groups
- `payment-catalog.ts` — stable Actual schedule identities across months, including retained schedules outside the history window

Workspace GETs read the mirrors and the local Actual copy; they never sync or write. Missing Actual data remains unavailable.
