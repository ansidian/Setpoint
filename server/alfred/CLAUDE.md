# Server Alfred Map

Alfred: the read-only, tool-calling assistant run loop behind the Alfred Panel. Entry point for routes is `alfred-run.ts`; tools wrap existing domain services and never mutate anything. Trust rules (read-only v1, cite-by-reference rows, untrusted email content) are decided in `docs/adr/0006-alfred-trust-architecture.md` — do not relax them here.

## Files

- `alfred-run.ts` — provider-neutral tool orchestration loop; emits the SSE run-event contract
- `alfred-provider.ts` — selects the conversation-bound provider adapter
- `anthropic-adapter.ts` / `openai-adapter.ts` — provider request, transcript, tool-result, and usage translation
- `anthropic-stream.ts` / `openai-stream.ts` — provider SSE stream parsers
- `alfred-tools.ts` — read-only tool definitions/executors over email, calendar, deadlines, bills, transactions/spending; `show_items` emits cached rows by reference
- `alfred-email-content.ts` — email-content shaping for tool results: `<email_content>` trust fencing, sender formatting, quoted-chain stripping, the compact search-candidate row
- `alfred-conversations.ts` — in-memory conversation store (TTL) and per-conversation item cache
- `alfred-types.ts` — server-local provider, conversation, dependency, usage, and run-loop contracts
- `alfred-prompt.ts` — system prompt: Pacific date anchor, coverage, trust rules
- `alfred-models.ts` — centralized catalog facade plus persisted Settings resolution
- `alfred-usage.ts` — usage rows into `ea_alfred_usage` (run turns + per-tool calls)
- `alfred-usage-stats.ts` — aggregates `ea_alfred_usage` into the Alfred analytics summary (queries, cache hit, savings, model split, per-tool latency/errors)

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- Cite-by-reference backstop: if a run retrieved a small item set and tries to finish without `show_items`, `alfred-run.ts` injects a one-time `<system-reminder>` user turn instead of ending — prompt rules alone proved unreliable on Haiku.

- Tools receive injectable `deps`; the route (`server/routes/alfred.ts`) provides real services, tests provide fakes.
- Email content in tool results is wrapped in `<email_content>` tags; the prompt declares it untrusted data.
- Conversations are ephemeral by design (CONTEXT.md: **Alfred Conversation**); do not add durable history without revisiting that decision.
- Provider/model is bound when the conversation is created. Settings changes apply only after New chat; clients never submit model overrides.

## Related

- `server/routes/alfred.ts` — HTTP surface (streamed `POST /run`, conversation delete)
- `server/email/search/` — retrieval engine behind `search_email`
- `docs/adr/0006-alfred-trust-architecture.md` — trust posture
