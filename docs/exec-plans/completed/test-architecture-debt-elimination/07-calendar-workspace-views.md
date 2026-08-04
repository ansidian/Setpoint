# 07 — Calendar Workspace and Views

**Parent:** [`00-parent.md`](00-parent.md)
**Status:** `complete`
**Depends on:** 06

## Goal

Remove every remaining allowance under `src/components/calendar/**` not owned by child 06, covering the modal workspace, grids, navigation, agenda, search, bills, deadlines, overlays, and responsive views.

## Starting inventory

- 27 unique files.
- 7 local mock edges across 4 files.
- 116 interaction assertions across 26 files.

Recomputed from `scripts/lib/test-architecture-baseline.json` at child start:

| File | Cases | LOC | Local mock edges | Interaction assertions |
| --- | ---: | ---: | ---: | ---: |
| `src/components/calendar/CalendarMobileAgenda.test.tsx` | 7 | 123 | 2 | 6 |
| `src/components/calendar/CalendarModal.agenda-today.test.tsx` | 10 | 561 | 0 | 1 |
| `src/components/calendar/CalendarModal.bills.test.tsx` | 10 | 510 | 0 | 0 |
| `src/components/calendar/CalendarModal.dashboard-focus.test.tsx` | 6 | 271 | 0 | 1 |
| `src/components/calendar/CalendarModal.deadline-overlay.test.tsx` | 7 | 347 | 0 | 1 |
| `src/components/calendar/CalendarModal.mini-calendar.test.tsx` | 6 | 304 | 0 | 3 |
| `src/components/calendar/CalendarModal.todoist-deadlines.test.tsx` | 12 | 411 | 0 | 2 |
| `src/components/calendar/CalendarModal.todoist-editor.test.tsx` | 8 | 309 | 0 | 2 |
| `src/components/calendar/modal/CalendarCell.test.tsx` | 6 | 152 | 0 | 6 |
| `src/components/calendar/modal/CalendarCellItemStack.test.tsx` | 12 | 388 | 0 | 5 |
| `src/components/calendar/modal/CalendarEventSelectionSurfaces.test.tsx` | 6 | 271 | 0 | 14 |
| `src/components/calendar/modal/CalendarEventSpanOverlay.test.tsx` | 5 | 259 | 0 | 4 |
| `src/components/calendar/modal/CalendarFloatingDetailPanel.test.tsx` | 6 | 536 | 0 | 2 |
| `src/components/calendar/modal/CalendarGrid.motion.test.tsx` | 11 | 455 | 0 | 7 |
| `src/components/calendar/modal/CalendarGrid.performance.test.tsx` | 5 | 365 | 3 | 3 |
| `src/components/calendar/modal/CalendarInlineOverflowLayer.test.tsx` | 4 | 127 | 0 | 0 |
| `src/components/calendar/modal/CalendarModalHeader.test.tsx` | 8 | 120 | 0 | 5 |
| `src/components/calendar/modal/CalendarScrollContainer.test.tsx` | 14 | 500 | 0 | 7 |
| `src/components/calendar/modal/CalendarSearchRail.test.tsx` | 9 | 410 | 0 | 16 |
| `src/components/calendar/modal/calendarCellItemMetrics.test.ts` | 6 | 25 | 0 | 0 |
| `src/components/calendar/views/agenda/AgendaRailShell.test.tsx` | 5 | 423 | 0 | 15 |
| `src/components/calendar/views/agenda/MiniCalendar.test.tsx` | 3 | 99 | 0 | 0 |
| `src/components/calendar/views/bills/BillsAgendaRail.test.tsx` | 4 | 134 | 0 | 1 |
| `src/components/calendar/views/deadlines/DeadlineDetailCompletionState.test.tsx` | 3 | 135 | 1 | 0 |
| `src/components/calendar/views/detailTimeline.test.tsx` | 9 | 298 | 1 | 7 |
| `src/components/calendar/views/events/EventsAgendaDeadlineRow.test.tsx` | 2 | 116 | 0 | 1 |
| `src/components/calendar/views/events/EventsAgendaRail.test.tsx` | 15 | 433 | 0 | 7 |
| **Total** | **199** | **8,082** | **7** | **116** |

The 26 interaction keys include four zero-valued ratchet entries. The exact mock edges are the two internal child-view replacements in `CalendarMobileAgenda.test.tsx`, three internal grid collaborators in `CalendarGrid.performance.test.tsx`, and the API replacements in `DeadlineDetailCompletionState.test.tsx` and `detailTimeline.test.tsx`.

## Execution ledger

Primary rendered owners are grouped by behavior family rather than file adjacency:

- Workspace orchestration: rendered `CalendarModal` owns today/agenda landing, bills and deadline range states, dashboard focus, mini-calendar navigation, Todoist detail/editor transitions, and search-to-grid activation.
- Mobile workspace: rendered `CalendarMobileAgenda` owns month/view chrome and detail-sheet lifecycle, with the real agenda and detail compositions mounted.
- Grid and selection: rendered `CalendarGrid`, `CalendarCell`, `CalendarCellItemStack`, span/overflow surfaces, and their real composition own visible selection, overflow, drag/drop, and modifier-selection behavior; pure capacity and geometry models remain thin input/output owners.
- Search and navigation: rendered `CalendarSearchRail`, `CalendarModalHeader`, and `AgendaRailShell` own accessible keyboard/focus/scroll behavior.
- Domain rails and detail: rendered event, deadline, bill, and transaction rails own visible state and action reconciliation; outbound HTTP and imperative browser commands may remain only with construct-local rationale where rendered state cannot prove the contract.
- Performance: the real `CalendarGrid` composition owns descriptor/memo stability; internal module replacement is not an acceptable performance seam.

Implementation will proceed in reviewable families, with the baseline ratcheted after each completed family: zero-valued keys; workspace integration; grid/selection/performance; search/navigation/scroll; mobile/domain rails/detail.

## Primary behavior direction

- Render user-visible workspace behaviors through real view/controller composition.
- Keep pure geometry/layout/date calculations as direct input/output owners where DOM measurement is not the requirement.
- Observe visible dates, rows, selections, panels, loading/error states, and accessible controls instead of prop/callback topology.

## Locked decisions

- Preserve desktop/mobile parity, overflow geometry, scroll/navigation, search activation, bills/deadlines status, and accessibility coverage.
- Mock API/browser measurement/portal boundaries only; do not mock Calendar child views to test composition.
- Avoid rebuilding a large acceptance suite; each workflow has one primary rendered owner plus thin pure policy owners.

## Acceptance criteria

- No owned baseline entry remains.
- Primary tests survive decomposition and hook movement that preserve visible behavior.
- Duplicate hop/call-count cases are removed only after the rendered owner is complete.
- Geometry and browser-boundary interactions are individually justified.

## Verification

- Focused Calendar workspace suites, build, and parent shared checks.

## Non-goals

- No Calendar UI redesign.

## Completed disposition — 2026-08-03

### Primary behavior owners and decisions

- Workspace orchestration stays owned by the rendered `CalendarModal` suites. Today/agenda landing, bills and deadline range state, dashboard focus, mini-calendar navigation, Todoist detail/editor routing, and search activation are observed through dates, selected cells, visible rails, editor/detail state, and scroll position.
- Mobile workspace behavior now renders the real agenda and floating-detail compositions. A stateful parent observes BottomSheet dismissal and KeepAlive hide cleanup; the two internal child-view mocks were removed.
- Grid correctness remains with rendered grid/cell/stack/overflow suites plus the existing pure geometry, span, row, selection, drag, and settle models. The standalone selection-surface suite and leaf callback checks were deleted as duplicates of `CalendarModal.events.test.tsx`, `CalendarModal.workspace-parking.test.tsx`, child 06 action coverage, and pure selection policy.
- Grid performance coverage no longer replaces `CalendarCellItemStack`, span layout, or grid-row policy. The remaining rendered owner proves a ghost-title edit reaches the real grid; private invocation counts and child render counts were deleted.
- Header keyboard behavior now uses a controlled rendered header and verifies `aria-selected`. Search presentation remains local; controller routing stays owned by the rendered search workflow and `useCalendarModalSearch`.
- Agenda imperative scrolling remains owned by `AgendaRailShell`, with two outer Mini Calendar integration seams. Only native scroll commands and native input selection/caret commands retain interactions because happy-dom cannot expose those commands as resulting layout state.
- Deadline completion remains owned by the rendered completion-state suite. It uses one fake outbound API boundary and observes pending, success, failure rollback, and reopen reconciliation. The duplicate completion case and API mock in `detailTimeline.test.tsx` were removed.

Allowance disposition totals: 7 local mock edges = 2 replaced / 4 deleted / 1 retained boundary; 116 interaction assertions = 20 replaced / 84 deleted / 12 retained browser boundaries. Every retained construct is individually justified below.

No production behavior or UI design changed. The Impeccable UI detector was not applicable because only test files, the baseline, and execution documents changed.

### Exact metrics

- Owned baseline files: 27 → 0; every child-07 key is absent from both baseline objects.
- Owned test files: 27 → 26; the duplicate `CalendarEventSelectionSurfaces.test.tsx` suite was deleted after its rendered and pure owners were verified.
- Owned executable cases: 199 → 176.
- Owned test LOC: 8,082 → 7,068.
- Local module mock edges: 7 → 0 baseline allowances.
- Interaction assertions: 116 → 0 baseline allowances.
- Implementation footprint excluding plan docs: 24 tracked paths — 22 modified tests, 1 deleted duplicate test, and the baseline.
- Remaining program debt after this child: 143 local mock edges and 748 interaction assertions.

### Retained inline boundary exemptions

Result/state observation is insufficient for these exact constructs; no internal collaborator mock or callback interaction remains exempt:

| File | Constructs | Why retained |
| --- | ---: | --- |
| `CalendarModal.mini-calendar.test.tsx` | 2 interactions | Exact imperative agenda landing and forbidden passive feedback scroll are browser commands not represented by happy-dom layout. |
| `modal/CalendarSearchRail.test.tsx` | 3 interactions | Native input select-all suppression and caret placement have no rendered DOM state in happy-dom. |
| `views/agenda/AgendaRailShell.test.tsx` | 7 interactions | Cold-entry suppression, exact auto/smooth targets, replacement commands, and duplicate-command prevention are imperative browser scroll contracts. |
| `views/deadlines/DeadlineDetailCompletionState.test.tsx` | 1 mock | The fake outbound HTTP adapter prevents Todoist access while the real rendered deadline state owns pending/success/failure/reopen behavior. |
| **Total** | **13** | **1 individually justified outbound mock and 12 individually justified browser interactions.** |

### Verification evidence

- Focused child run: 26 files / 176 tests passed together.
- Cross-owner run: 9 files / 65 tests passed for Calendar selection, overflow, agenda scroll, deadline actions, search, and scroll/settle policy.
- `npm run check:harness`: passed; no owned baseline key remains and every inline rationale is construct-local.
- `npm run check:exports`: passed; 0 unexpected and 0 stale exemptions.
- `npm run typecheck`: passed.
- `npm run typecheck:tools`: passed.
- `npm run lint`: passed.
- `npm run test:fast`: 582 files / 4,238 tests passed without retry.
- `npm run build`: passed.
- `git diff --check`: passed.
- `npm run test:slow` was not applicable: this child changed frontend tests only, with no server, persistence, filesystem, or provider-storage implementation.

## Handoff

Child 07 is complete. Child 08 is the next eligible child in manifest order. Do not start it in this session.
