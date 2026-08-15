# Alfred Panel Map

The Alfred Panel (CONTEXT.md): right-docked dashboard chat over `POST /api/alfred/run`. Read-only v1; trust rules live in `docs/adr/0006-alfred-trust-architecture.md`. Entry points: ⌘\ toggle, ⌘⇧\ new chat, inbox query handoff (⌘Enter / Sparkles), and the desktop reader's model-free email-context handoff. No launcher pill by design.

## Files

- `AlfredPanel.tsx` — panel chrome: header/thread/composer, empty state, query/email handoffs, pending-context lifecycle, and new-chat effects
- `useAlfredChat.ts` — run lifecycle: streaming submit, abort, new chat (clears messages + composer draft), conversation id
- `alfredPanelModel.ts` — pure SSE-event → message-list reducer, active-model formatter, copy, and row formatters. Say model: a say closed by a `tool_start` is a between-tool **preamble** (kept, tagged `preamble`, rendered as quiet prose so the narration persists); only a say still open at `run_end` is the **answer** (a structured Setpoint sans-serif block with a semibold opening sentence). A fresh narration settles the live tools block before it; `finishTools` settles all live blocks at run_end as a backstop (a run interleaves one tools block per narration segment). Empty/whitespace-only opening deltas are ignored, not kept as blank preambles.
- `AlfredMessages.tsx` — UserLine, ToolRows, SayBlock (`preamble`/streaming → quiet prose; `done && !preamble` → safe structured rich text), ErrorLine, SuggestionList (message leaves are React.memo'd: untouched messages stay referentially stable so token streaming only re-renders the active say block)
- `AlfredRichText.tsx` — completed-answer Markdown subset: paragraphs, automatic semibold opening sentence, bold/italic/code, unordered/numbered lists, and http(s)-only links (suppressed in demo). Raw HTML is always escaped; headings are intentionally unsupported.
- `AlfredComposer.tsx` — input + send button + shortcut/model footer; owns and restores the local draft, renders pending email context, and gates send until preparation is ready
- `AlfredEmailContext.tsx` — pending/sent email reference cards and the conditional earlier-email/context-overflow notice
- `alfredEmailContextModel.ts` — pure pending-context projection into display references and preview items
- `AlfredRows.tsx` — verbatim domain rows: bill/event/deadline/email/transaction (cite-by-reference; never reshape values)
- `AlfredEmailPreview.tsx` — read-only email preview overlay opened from an email chip (Esc/outside-click close it, never the panel)
- `alfredChipActionModel.ts` — pure chip-click → navigation action resolver (email preview vs calendar request via the dashboard's request builders)
- `alfredRowOrdering.ts` — pure sort/section logic for surfaced rows: ordering rules and kind-based sectioning for the Alfred panel result list
- `AlfredTransactionBreakdown.tsx` — auto-rendered breakdown card for the summarize_transactions tool result (spending or income): accent-driven proportional bars, period/group-by header, "Other" greyed, reduced-motion-safe bar-grow animation
- `AlfredBreakdown.tsx` — auto-rendered grouped-count card for the group_items tool result: count bars + adaptive drill-down (buckets ≤5 inline, >5 collapse) reusing the per-kind leaf row components exported from `AlfredRows.tsx`; cite-by-reference (ADR 0006)

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- All message-list logic is pure in `alfredPanelModel.ts`; components stay presentational.
- The panel stays mounted while closed (translateX off-screen) so the conversation survives close/reopen; only new chat clears it.
- SSE consumption is fetch + `src/lib/sseStream.ts` (EventSource can't POST).
- Email handoff preparation is model-free. The browser keeps display metadata plus an opaque context ID; successful `run_end` is the server-side consumption boundary.
- Chips are interactive: rows resolve their navigation action via `alfredChipActionModel.ts`; calendar actions bubble to DashboardShell (closes the panel, opens the calendar), email actions stay panel-local.
- Layering: the panel portals to `document.body` (zIndex 60, above the calendar modal's 49) and carries `data-suspend-calendar-hotkeys="all"` — a marker the calendar honors to ignore BOTH its global hotkeys and its outside-click dismissal for events originating inside the overlay (so clicking Alfred over an open calendar never closes it). The panel owns Esc ordering (preview first, panel second) via a document-capture listener.

## Related

- `server/alfred/` — the run loop and SSE contract
- `src/components/dashboard/DashboardShell.tsx` — mount + hotkey wiring
- `src/components/inbox/` — ⌘Enter / Sparkles handoff source
