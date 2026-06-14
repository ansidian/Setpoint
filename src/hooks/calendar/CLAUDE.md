# Calendar Hooks Map

Calendar domain and view state: range fetching/caching, modal interaction (selection, search, hotkeys, dismissal), floating detail anchoring, and editor routing. Entry point is `useCalendarModalController.jsx`, which wires the sub-hooks and hands bundles to the modal shell. Pure model files (suffixed `Model`) export stateless logic; hooks own effects and React state.

## Files

### Models (pure)
- `calendarRangeModel.js` — month key arithmetic, range expansion, fetch grouping
- `calendarScrollModel.js` — month index math, navigable radius, scroll direction, prefetch range
- `calendarScrollSyncModel.js` — pure decisions for grid↔agenda scroll sync
- `calendarGridRowModel.js` — fixed week-row heights and per-month row layout math
- `agendaFetchModel.js` — agenda month fetch planning: initial months, scroll prefetch
- `agendaScrollModel.js` — agenda scroll math (no runtime consumers yet; covered by its tests)
- `calendarPlanningSessionModel.js` — planning state transitions (idle/loading/slow/degraded)
- `calendarFloatingDetailModel.js` — floating detail predicates, anchor logic, reanchoring rules
- `calendarModalInteractionModel.js` — storage keys, view normalization, deadline-create logic
- `calendarModalSearchModel.js` — search scope, placeholders, coverage checks, result filtering
- `calendarModalSelectionModel.js` — focus date parsing, grid visibility, view sync snapshots

### Controller + view model
- `useCalendarModalController.jsx` — main orchestrator wiring sub-hooks and editors
- `useCalendarModalViewModel.js` — visible month data and shell prop building
- `useCalendarModalSelection.js` — view date, selected day, focus tracking per open request

### Modal behavior
- `useCalendarModalSearch.js` — search UI state, debounced API calls, highlighting
- `useCalendarModalHotkeys.js` — escape, arrow nav, month pagination, modifier-key dismissal
- `useCalendarModalOutsideDismiss.js` — click-outside dismissal, suppression map, focus capture
- `useCalendarModalWheelContainment.js` — stops wheel scroll escaping the modal

### Floating detail + editor routing
- `useCalendarFloatingDetail.js` — floating detail anchoring, session memory, placement
- `useFloatingEditorRouting.js` — unified deadline/event editor routing, save→detail transitions
- `useCalendarModalEditorRouting.js` — backward-compat re-export wrapper

### Domain state + lifecycle
- `useCalendarRange.js` — per-month event caching/fetching, prefetch radius, staleness
- `useCalendarDomainRange.js` — deadline/bill prefetch planning from visible bounds
- `useAgendaFetch.js` — agenda month fetching: initial mount fetch, scroll-driven prefetch
- `useCalendarScrollSync.js` — grid↔agenda scroll orchestration: settle-driven sync, navigation commands
- `useStaleDomainCache.js` — generic TTL-gated cache wrapper for domain fetches
- `useDeadlineOverlayState.js` — overlay visibility triad with persistence
- `usePlanningReadinessState.js` — planning state machine, deadline fetch orchestration
- `useAgendaSyncPolicy.js` — passive sync suppression window, grid-owned selection gate

### Utilities
- `useDashboardFocusRetry.js` — polling/backoff retry for dashboard-detail focus attach
- `useViewportWidth.js` — RAF-debounced viewport width listener

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Calendar hooks/models live here, UI in `src/components/calendar/` — do not add calendar files elsewhere.
- Model files are pure and unit-tested directly; hooks consume them and own side effects.
- Selection and dismissal share suppression conventions — check `useCalendarModalOutsideDismiss.js` before adding new dismiss paths.

## Related

- `src/components/calendar/modal/` — shell consuming these bundles (see its map)
- `src/components/calendar/events/` — editor invoked via `useFloatingEditorRouting.js`
