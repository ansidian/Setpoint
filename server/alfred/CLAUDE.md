# Server Alfred Map

Alfred: the tool-calling assistant run loop behind the Alfred Panel. Domain tools stay read-only; `propose_calendar_event` may stage one ephemeral, non-mutating proposal for explicit owner review in Calendar. Trust rules live in `docs/adr/0006-alfred-trust-architecture.md` — do not relax them here.

## Files

- `alfred-run.ts` — provider-neutral tool orchestration loop; emits the SSE run-event contract
- `alfred-provider.ts` — selects the conversation-bound provider adapter
- `anthropic-adapter.ts` / `openai-adapter.ts` — provider request, transcript, tool-result, and usage translation
- `anthropic-stream.ts` / `openai-stream.ts` — provider SSE stream parsers
- `alfred-tools.ts` — read-only domain tools plus non-mutating calendar proposal staging; `show_items` emits cached rows by reference
- `alfred-calendar-proposals.ts` — semantic owner intent with exact trusted-turn provenance, provider-empty field normalization, field/date/source validation, duplicate policy, and atomic run-local proposal staging
- `alfred-email-content.ts` — email-content shaping for tool results: `<email_content>` trust fencing, sender formatting, the compact search-candidate row
- `alfred-email-context.ts` — whole-email preparation for deliberate reader attachments: semantic text, link/image/file shaping, metadata authority, 50k limit, and trust fencing
- `alfred-email-context-store.ts` — bounded owner-scoped prepared-context handles with TTL and claim/release/consume lifecycle
- `alfred-conversations.ts` — in-memory conversation store (TTL), item cache, and ephemeral proposal identity/status
- `alfred-types.ts` — server-local provider, conversation, dependency, usage, and run-loop contracts
- `alfred-prompt.ts` — system prompt: Pacific date anchor, coverage, trust rules
- `alfred-models.ts` — centralized catalog facade plus persisted Settings resolution
- `alfred-usage.ts` — usage rows into `ea_alfred_usage` (run turns + per-tool calls)
- `alfred-usage-stats.ts` — aggregates `ea_alfred_usage` into the Alfred analytics summary (queries, cache hit, savings, model split, per-tool latency/errors)

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Cite-by-reference backstop: if a run retrieved a small item set and tries to finish without `show_items`, `alfred-run.ts` injects a one-time `<system-reminder>` user turn instead of ending — prompt rules alone proved unreliable on Haiku.

- Tools receive injectable `deps`; the route (`server/routes/alfred.ts`) provides real services, tests provide fakes.
- Email content in tool results is wrapped in `<email_content>` tags; the prompt declares it untrusted data.
- Direct email attachments are prepared before a run and claimed by opaque ID. Failed runs release the handle; only `run_end` consumes it.
- Conversations are ephemeral by design (CONTEXT.md: **Alfred Conversation**); do not add durable history without revisiting that decision.
- Calendar proposals commit to conversation state only with a successful `run_end`. Review is UI-only; Calendar's existing editor remains the sole event-write boundary.
- Owner instructions and duplicate confirmations are not keyword-matched. The tool quotes a complete owner message; the server resolves it only against separate, unconsumed trusted-owner turns and consumes the evidence at proposal commit.
- Provider/model is bound when the conversation is created. Settings changes apply only after New chat; clients never submit model overrides.

## Related

- `server/routes/alfred.ts` — HTTP surface (model-free email-context prepare/discard, streamed `POST /run`, identity-only proposal Created acknowledgement, conversation delete)
- `server/email/search/` — retrieval engine behind `search_email`
- `docs/adr/0006-alfred-trust-architecture.md` — trust posture
