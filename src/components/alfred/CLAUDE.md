# Alfred Panel Map

The desktop-only Alfred Panel (CONTEXT.md): a centered workbench or an Inbox-integrated conversation over `POST /api/alfred/run`. Domain tools are read-only; explicit owner requests may produce a non-mutating calendar proposal reviewed and committed through Calendar's existing editor. Trust rules live in `docs/adr/0006-alfred-trust-architecture.md`. Desktop entry points: ⌘\ toggle, ⌘⇧\ new chat, inbox query handoff (⌘Enter / Sparkles), and the reader's model-free email-context handoff. Mobile exposes no Alfred entry point or panel. The desktop shell has a visible Ask Alfred button; demo omits Alfred.

## Files

- `AlfredSurface.tsx` / `AlfredSurface.css` — stable body portal, centered workbench or measured Inbox layout slot, focus return and responsive/reduced-motion chrome
- `AlfredEvidence.css` — source/attachment affordances for genuine actions only
- `AlfredPanel.tsx` — panel chrome: header/thread/composer, empty state, query/email handoffs, pending-context lifecycle, and new-chat effects
- `useAlfredChat.ts` — run lifecycle: streaming submit, explicit Stop/abort, new chat, conversation id, proposal expiry, and identity-only Created acknowledgement retry
- `alfredPanelModel.ts` — pure SSE-event → message-list reducer, proposal lifecycle, active-model formatter, copy, and row formatters. Say model: a say closed by a `tool_start` is a between-tool **preamble** (kept and tagged `preamble`); only a say still open at `run_end` is the **answer**. A fresh narration settles the live tools block before it; `finishTools` settles all live blocks at run_end as a backstop (a run interleaves one tools block per narration segment). Empty/whitespace-only opening deltas are ignored, not kept as blank preambles.
- `alfredMessagePresentation.ts` — presentation-only projection of each user turn's ordered preambles and tools into one work history; source cards, answers, notices, and errors remain outside it. The current history stays open while the run is busy; completed histories collapse independently.
- `AlfredCalendarProposalCard.tsx` — compact Proposed/Superseded/Created card with duplicate/source/past states, detail disclosure, Review/Try again, and saved-event truth
- `alfredCalendarProposalModel.ts` — validated proposal → typed Calendar seed/request projection and normalized saved-event display projection
- `AlfredMessages.tsx` — UserLine, WorkHistory, ToolRows, SayBlock (`preamble`/streaming → quiet prose; `done && !preamble` → safe structured rich text), ErrorLine, SuggestionList. Work history includes failure/incomplete counts and full wrapping summaries; tools without a result stop spinning once the run ends. Message leaves are React.memo'd so untouched leaf content skips token-stream renders.
- `AlfredRichText.tsx` — completed-answer Markdown subset: paragraphs, explicit bold/italic/code, unordered/numbered lists, and http(s)-only links (suppressed in demo). Raw HTML is always escaped; headings are intentionally unsupported. The renderer does not add emphasis to plain text.
- `AlfredComposer.tsx` — editable suggestion-prefilled multiline composer + Send/Stop + shortcut/model footer; owns and restores the local draft, renders pending email context, and gates send until preparation is ready
- `AlfredEmailContext.tsx` — pending/sent email reference cards and the conditional earlier-email/context-overflow notice
- `alfredEmailContextModel.ts` — pure pending-context projection into display references and preview items
- `AlfredRows.tsx` — verbatim domain rows: bill/event/deadline/email/transaction (cite-by-reference; never reshape values)
- `AlfredEmailPreview.tsx` — adapts a surfaced email into the shared centered `src/components/email/EmailPreviewModal.tsx`; its full-viewport backdrop dismisses over Inbox iframes, Escape closes the preview first, and focus returns to the opening row while Alfred stays mounted
- `alfredChipActionModel.ts` — pure chip-click → navigation action resolver (email preview, exact Finances targets, or calendar request via the dashboard's request builders)
- `alfredRowOrdering.ts` — pure sort/section logic for surfaced rows: ordering rules and kind-based sectioning for the Alfred panel result list
- `AlfredTransactionBreakdown.tsx` — auto-rendered breakdown card for the summarize_transactions tool result (spending or income): accent-driven proportional bars, period/group-by header, "Other" greyed, reduced-motion-safe bar-grow animation
- `AlfredBreakdown.tsx` — auto-rendered grouped-count card for the group_items tool result: count bars + adaptive drill-down (buckets ≤5 inline, >5 collapse) reusing the per-kind leaf row components exported from `AlfredRows.tsx`; cite-by-reference (ADR 0006)

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- SSE-state and domain message-list logic is pure in `alfredPanelModel.ts`; `alfredMessagePresentation.ts` groups the display without changing the transcript, and components stay presentational.
- The panel stays mounted while closed (hidden/inert) so conversation and draft survive close/reopen and page switches; only new chat clears them. Suggestions prefill and focus the composer; only explicit Send invokes the model.
- SSE consumption is fetch + `src/lib/sseStream.ts` (EventSource can't POST).
- Email handoff preparation is model-free. The browser keeps display metadata plus an opaque context ID; successful `run_end` is the server-side consumption boundary.
- Calendar proposal Review sends a typed seed through the dashboard bridge and performs no write. The panel closes only after editor acceptance; Calendar completion updates the mounted card from the normalized saved event.
- Chips are interactive: rows resolve their navigation action via `alfredChipActionModel.ts`; calendar and financial actions bubble to DashboardShell (closes the panel, opens the matching workspace), email actions stay panel-local.
- Layering: the panel portals to `document.body` (zIndex 60, above the calendar modal's 49) and carries `data-suspend-calendar-hotkeys="all"` — a marker the calendar honors to ignore BOTH its global hotkeys and its outside-click dismissal for events originating inside the overlay (so clicking Alfred over an open calendar never closes it). The shared source dialog sits above popovers and owns Escape while open; the panel's document-capture listener handles Escape only when no preview is open.

## Related

- `server/alfred/` — the run loop and SSE contract
- `src/components/dashboard/DashboardShell.tsx` — mount + hotkey wiring
- `src/components/inbox/` — desktop ⌘Enter / Sparkles handoff source
