# Financial Provider Parsers

Pure, source-grounded company parsing. The public assessment facade returns parsed financial facts, review with optional partial facts, known nonfinancial content, or an unrecognized sender. Recognition never grants financial automation authority.

## Files

- `index.ts` — explicit registry, exact mailbox identification, shared InvoiceCloud brand guard, public assessment and policy version
- `parser-helpers.ts` — bounded source normalization, labeled monetary/date extraction, evidence projection, completeness and conflict checks; no provider SDKs or persistence
- `sce.ts`, `socalgas.ts`, `sgv-water.ts`, `valley-vista.ts`, `spectrum.ts` — utility-owned templates, including Valley Vista extracted PDF tables
- `sofi.ts`, `us-bank.ts`, `chase.ts`, `citi.ts` — issuer-owned statement, payment notice, transaction alert and reward templates
- `paypal.ts` — Synchrony card statements/autopay/refunds, merchant receipts/refunds/authorizations, balance transfers and received-money notices; owns recognition of grounded PayPal balance movements in retained historical candidates
- `amazon.ts` — initial order confirmation, refund and fulfillment families
- `ebay.ts` — content-gated packing notifications only; other eBay templates retain AI assessment
- `fixtures/historical.json` — sanitized historical text/table excerpts with fictional personal/account identities; retains label order and whitespace from real normalized sources

- `replay-report.ts` — pure registry replay and redacted provider/template/version/disposition aggregation; no orchestration, credentials or writes

## Boundaries

- Accept complete normalized email/PDF evidence. Acquisition, authentication, profile resolution, event correlation, retries and Actual writes belong to their existing owners.
- Company modules own template matching, label semantics and provider-specific recognition of retained candidates. Shared helpers do not choose a company's operational amount or infer accounting destinations.
- Keep multiple/conflicting values in review. Minimum due is never the full statement balance. Marketing amounts, funding suffixes, pending refunds and alert thresholds cannot become financial facts by proximity.
- An initial Amazon confirmation may retain a null operation date with explicit initial-confirmation context. Only the financial-event owner derives source-bound email-date provenance.
- Changing parser behavior requires changing the provider parser version; changing shared normalization or registry behavior requires changing `FINANCIAL_PROVIDER_PARSER_POLICY` as well.
- Browser-safe provider identities/catalog and assessment contracts live in `shared/types/financial-parsers.ts`.
- Original private corpus and production-recovery evidence remain under gitignored `docs/exec-plans/active/provider-financial-parsing/corpus/`.
