# Server Transactions Map

Read-only access to Actual Budget transaction data for Alfred (and the future
agentic write flow). Reads the on-disk budget copy directly — never boots the
Actual SDK (see `docs/exec-plans/active/2026-06-14-alfred-transaction-access-design.md`).

## Files

- `transactions-service.js` — public API: `queryTransactions` (filtered expense list)
  and `summarizeSpending` (aggregate by category/payee/month). Filter policy, JS
  aggregation (top-15 + Other), `sync_state`, graceful errors. Injectable deps.

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Spending = expenses only (outflows); income and transfers are excluded.
- Reads go through `server/actual/actual-transactions-read.js` → on-disk `db.sqlite`
  via `@libsql/client`. No SDK, no budget-in-heap (Render 512MB firewall).
- `sync_state` freshness is best-effort, sourced from `getBillsMirrorState`.

## Related

- `server/actual/actual-transactions-read.js` — the low-level reader.
- `server/alfred/alfred-tools.js` — `search_transactions` / `summarize_spending`.
- `docs/adr/0006-alfred-trust-architecture.md` — read-only trust posture.
