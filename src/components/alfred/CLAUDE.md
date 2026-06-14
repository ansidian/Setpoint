# Alfred Panel Map

The Alfred Panel (CONTEXT.md): right-docked dashboard chat over `POST /api/alfred/run`. Read-only v1; trust rules live in `docs/adr/0006-alfred-trust-architecture.md`. Entry points: ⌘\ toggle, ⌘⇧\ new chat, inbox handoff (⌘Enter / Sparkles). No launcher pill by design.

## Files

- `AlfredPanel.jsx` — panel chrome: header/thread/composer, empty state, handoff + new-chat effects
- `useAlfredChat.js` — run lifecycle: streaming submit, abort, new chat (clears messages + composer draft), conversation id
- `alfredPanelModel.js` — pure SSE-event → message-list reducer, model catalog, formatters, suggestions
- `AlfredMessages.jsx` — UserLine, ToolRows, SayBlock (serif lead), ErrorLine, SuggestionList, ModelToggle
- `AlfredRows.jsx` — verbatim domain rows: bill/event/deadline/email (cite-by-reference; never reshape values)
- `AlfredEmailPreview.jsx` — read-only email preview overlay opened from an email chip (Esc/outside-click close it, never the panel)
- `alfredChipActionModel.js` — pure chip-click → navigation action resolver (email preview vs calendar request via the dashboard's request builders)

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
