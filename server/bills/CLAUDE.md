# Server Bills Map

Bill domain logic: AI extraction from emails, user bill-matching rules, and the bills mirror. Entry point is `bills-service.js`, which drives the `server/actual/` engine layer and owns Actual-metadata invalidation fan-out on writes.

## Files

- `bills-service.js` — public bills API; owns Actual-metadata invalidation fan-out on writes
- `bill-extract.js` — trims HTML email bodies to payee/amount/date context for AI
- `bill-extraction-service.js` — runs the LLM extractor, resolves category/account IDs
- `bill-extractors/catalog.js` — provider/model registry with env-key availability checks
- `bill-extractors/anthropic.js` — Claude tool-use extraction call
- `bill-extractors/openai.js` — OpenAI structured-JSON extraction call
- `bill-pay-mappings.js` — schema for user bill-matching rules (profiles, behaviors, targets)
- `bill-pay-resolver.js` — applies mappings to extracted/pasted bills: amounts, dates
- `bill-pay-service.js` — loads mappings + metadata, resolves bills against user rules
- `bills-mirror-sync.js` — syncs bill occurrences into `ea_bills_mirror_*`, schedules maintenance
- `bills-mirror-refresh-policy.js` — pure guard: should a reader kick an immediate mirror refresh, or is a settle window already armed

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Bills write through `server/actual/actual.js`; this domain decides *what* to write, the actual domain decides *how*.
- Extraction providers are registered in `bill-extractors/catalog.js`; add new providers there, not inline.

## Related

- `server/actual/` — engine layer this domain drives
- `server/routes/briefing/bills.js` — HTTP surface
- `FLOWS.md` — bill-pay/Actual sync flow, hop by hop
