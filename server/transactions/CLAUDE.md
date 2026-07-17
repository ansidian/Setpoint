# Server Transactions Map

Read-only access to Actual Budget transaction data for Alfred (and the future
agentic write flow). Reads the on-disk budget copy directly — never boots the
Actual SDK (see `docs/exec-plans/active/2026-06-14-alfred-transaction-access-design.md`).

## Files

- `transactions-service.ts` — public API: `queryTransactions` (filtered transaction list)
  and `summarizeTransactions` (aggregate by category/payee/month). Filter policy, JS
  aggregation (top-15 + Other), `sync_state`, graceful errors. Injectable deps.

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- direction "expense" (default) = outflows (amount < 0); direction "income" = inflows (amount > 0). Transfers are excluded in both directions.
- Internal calendar reads may use direction "all" to return both flows in one query; rows carry explicit `direction` and positive amount magnitudes.
- Reads go through `server/actual/actual-transactions-read.ts` → on-disk `db.sqlite`
  via `@libsql/client`. No SDK, no budget-in-heap (Render 512MB firewall).
- `sync_state` freshness is best-effort, sourced from `getBillsMirrorState`.

## Related

- `server/actual/actual-transactions-read.ts` — the low-level reader.
- `server/alfred/alfred-tools.ts` — `search_transactions` / `summarize_transactions`.
- `server/routes/calendar.ts` — combined transaction rows in the Bills calendar range response.
- `docs/adr/0006-alfred-trust-architecture.md` — read-only trust posture.
