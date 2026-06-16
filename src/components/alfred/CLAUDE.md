# Alfred Panel Map

The Alfred Panel (CONTEXT.md): right-docked dashboard chat over `POST /api/alfred/run`. Read-only v1; trust rules live in `docs/adr/0006-alfred-trust-architecture.md`. Entry points: ⌘\ toggle, ⌘⇧\ new chat, inbox handoff (⌘Enter / Sparkles). No launcher pill by design.

## Files

- `AlfredPanel.jsx` — panel chrome: header/thread/composer, empty state, handoff + new-chat effects
- `useAlfredChat.js` — run lifecycle: streaming submit, abort, new chat (clears messages + composer draft), conversation id
- `alfredPanelModel.js` — pure SSE-event → message-list reducer, model catalog, formatters, suggestions. Say model: a say closed by a `tool_start` is a between-tool **preamble** (kept, tagged `preamble`, rendered as quiet prose so the narration persists); only a say still open at `run_end` is the **answer** (serif). A fresh narration settles the live tools block before it; `finishTools` settles all live blocks at run_end as a backstop (a run interleaves one tools block per narration segment). Empty/whitespace-only opening deltas are ignored, not kept as blank preambles.
- `AlfredMessages.jsx` — UserLine, ToolRows, SayBlock (`preamble`/streaming → quiet prose; `done && !preamble` → serif lead), ErrorLine, SuggestionList, ModelToggle (message leaves are React.memo'd: untouched messages stay referentially stable so token streaming only re-renders the active say block)
- `AlfredComposer.jsx` — input + send button + shortcut/model footer; owns the draft in LOCAL state so a keystroke re-renders only the composer, not the thread (lifts to the chat hook only on submit; clears on the panel's new-chat signal)
- `AlfredRows.jsx` — verbatim domain rows: bill/event/deadline/email/transaction (cite-by-reference; never reshape values)
- `AlfredEmailPreview.jsx` — read-only email preview overlay opened from an email chip (Esc/outside-click close it, never the panel)
- `alfredChipActionModel.js` — pure chip-click → navigation action resolver (email preview vs calendar request via the dashboard's request builders)
- `alfredRowOrdering.js` — pure sort/section logic for surfaced rows: ordering rules and kind-based sectioning for the Alfred panel result list
- `AlfredTransactionBreakdown.jsx` — auto-rendered breakdown card for the summarize_transactions tool result (spending or income): accent-driven proportional bars, period/group-by header, "Other" greyed, reduced-motion-safe bar-grow animation
- `AlfredBreakdown.jsx` — auto-rendered grouped-count card for the group_items tool result: count bars + adaptive drill-down (buckets ≤5 inline, >5 collapse) reusing the per-kind leaf row components exported from `AlfredRows.jsx`; cite-by-reference (ADR 0006)

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- All message-list logic is pure in `alfredPanelModel.js`; components stay presentational.
- The panel stays mounted while closed (translateX off-screen) so the conversation survives close/reopen; only new chat clears it.
- SSE consumption is fetch + `src/lib/sseStream.js` (EventSource can't POST).
- Chips are interactive: rows resolve their navigation action via `alfredChipActionModel.js`; calendar actions bubble to DashboardShell (closes the panel, opens the calendar), email actions stay panel-local.
- Layering: the panel portals to `document.body` (zIndex 60, above the calendar modal's 49) and carries `data-suspend-calendar-hotkeys="all"` — a marker the calendar honors to ignore BOTH its global hotkeys and its outside-click dismissal for events originating inside the overlay (so clicking Alfred over an open calendar never closes it). The panel owns Esc ordering (preview first, panel second) via a document-capture listener.

## Related

- `server/alfred/` — the run loop and SSE contract
- `src/components/dashboard/DashboardShell.jsx` — mount + hotkey wiring
- `src/components/inbox/` — ⌘Enter / Sparkles handoff source
