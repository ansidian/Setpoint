# AI usage pricing

Checked 2026-09-10. Rates are USD per million tokens for standard direct API requests. `server/platform/ai-usage-tokens.ts` is the shared calculator for Alfred, triage, and financial email. This is an estimate of recorded usage, not an invoice reconciliation.

## OpenAI

All nine curated models were checked against the [official pricing page](https://developers.openai.com/api/docs/pricing) and their linked model references.

| Model | Input | Cache read | Output |
| --- | ---: | ---: | ---: |
| [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | 4 | 0.40 | 20 |
| [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | 2 | 0.20 | 12 |
| [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | 0.20 | 0.02 | 1.20 |
| [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) | 5 | 0.50 | 30 |
| [GPT-5.5 Pro](https://developers.openai.com/api/docs/models/gpt-5.5-pro) | 30 | 30* | 180 |
| [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) | 2.50 | 0.25 | 15 |
| [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) | 0.75 | 0.075 | 4.50 |
| [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano) | 0.20 | 0.02 | 1.25 |
| [GPT-5.4 Pro](https://developers.openai.com/api/docs/models/gpt-5.4-pro) | 30 | 30* | 180 |

*Pro has no cached-input discount; any reported cache reads are charged at the base input rate. GPT-5.6 cache writes cost 1.25× base input. Above 272K input tokens, GPT-5.6 charges 2× input and 1.5× output for the full request. Sol's current promotional pricing is available at least through November 21, 2026. Older OpenAI session-wide long-context premiums are not estimated here; such calls remain unpriced.

[Email Search's text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small) remains $0.02 per million input tokens. Its separate corpus-size projection uses a character heuristic; recorded embedding usage is reported separately.

## Anthropic

The catalog discovers Claude models dynamically. The calculator includes these source-checked entries and their dated snapshots. Future or unrecognized IDs remain unpriced. Rates from [official Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing):

| Models | Input | Cache read | Output |
| --- | ---: | ---: | ---: |
| Haiku 4.5 | 1 | 0.10 | 5 |
| Sonnet 4.5 / 4.6 | 3 | 0.30 | 15 |
| Opus 4.5 / 4.6 / 4.7 / 4.8 / 5 | 5 | 0.50 | 25 |
| Sonnet 5 | 2 | 0.20 | 10 |
| Fable 5 / Mythos 5 | 10 | 1 | 50 |
| Fable 5.1 / Mythos 5.1 | 10 | 0.25 | 50 |

Five-minute writes cost 1.25× base input; one-hour writes cost 2×. Claude 4.6+ uses standard rates through 1M context. Sonnet 5's $2/$10 introductory rates became standard; the proposed September increase did not occur. Anthropic input usage excludes cache reads and writes, so total input adds all three buckets.

## Accounting contract

- Provider selection filters all metrics, model breakdowns, and recent failures within a section. All providers is the default; the selected runtime model does not alter historical analytics.
- Alfred stores normalized tokens, estimated cost, net cache savings, and pricing version in the existing usage metadata. Historical rows without snapshots use their provider-shaped counts and today's calculator; cache writes never recorded cannot be reconstructed. Historical default cache writes use the five-minute rate used by Alfred's requests.
- Net savings compare actual estimated token cost to the same request without caching, including write premiums. Savings can be negative.
- Unknown usage, unknown models, unsupported tiers, and unsupported context sizes stay unpriced. Mixed totals show known cost with an unpriced count; entirely unpriced Alfred totals are unavailable.
- Alfred records completed model turns; interrupted/failed streams may be absent. Triage and financial email track provider attempts, including failures.
- Existing email-ledger cost snapshots are not rewritten. Provider discounts, taxes, credits, regional uplifts, and unrecorded calls are outside the estimate. No provider defaults or model selections changed.
