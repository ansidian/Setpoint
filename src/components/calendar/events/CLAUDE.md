# Calendar Events Map

Event creation and editing: the editor rail, natural-language title parsing, recurrence/reminder/location pickers, batch drafts, and recurring-scope prompts. Entry points are `useCalendarEventEditor.ts` (state orchestration) and `CalendarEventEditorRail.tsx` (UI composition).

## Files

### Editor core
- `useCalendarEventEditor.ts` — composes editor draft/picker/reminder/source state with mutation, history, and open-session hooks; retains typed create origin/completion through save while preserving the caller-facing controller
- `useCalendarEventCreateCoordination.ts` — focused in-memory create-request/origin lifecycle: session open wrapping, cancel/edit cleanup, existing saved-route composition, and exactly-once completion
- `useCalendarEventMutations.ts` — save/delete/reconnect mutation lifecycle: duplicate guards, batch/partial failures, reminder reconciliation, validation projection, and recurring scopes
- `useCalendarEditorHistory.ts` — browser-history ownership, dirty-state tracking, and cancel/pop coordination for the editor
- `useCalendarEventEditorSession.ts` — open create/edit lifecycle: request cancellation, typed create-seed application, intent-aware source seeding, existing-event draft/reminder hydration, and location state
- `calendarEventEditorErrors.ts` — editor error detail projection shared by the editor orchestrator and mutation hook
- `useCalendarEditorPickers.ts` — floating panel visibility and field anchor refs
- `calendarEventEditorModel.ts` — draft normalization, validation, recurrence serialization, batch ops
- `calendarEventEditorSessionModel.ts` — pure editor-session projections and transitions (create-seed normalization, source-intent resolution, validation visibility, title-assist draft sync, batch edits)
- `calendarEventEditorActions.ts` — CRUD/reminder API calls and error formatting
- `calendarEditorUtils.ts` — date/time formatting, style constants, field helpers

### Editor UI
- `CalendarEventEditorRail.tsx` — root editor layout combining sub-panels with animations
- `CalendarEventEditorPanels.tsx` — floating date/time/location/source/recurrence pickers
- `CalendarEventEditorHeader.tsx` — mode label and contextual copy (editing/batch/new)
- `CalendarEventEditorActionBar.tsx` — save/delete/cancel with confirmation states
- `CalendarEventEditorStatusMessages.tsx` — error and validation messaging
- `CalendarEditorControls.tsx` — shared editor control primitives

### Title + intent
- `CalendarEventTitleField.tsx` — title input with placeholder hints
- `CalendarEventTitleAssistPanel.tsx` — parsed location/calendar queries from the title
- `parseCalendarTitle.ts` — natural-language date/time extraction (Chrono, weekday patterns)
- `calendarTitleIntent.ts` — classifies title intent and builds batch/recurring/single drafts over the recurrence clause matcher
- `calendarRecurrenceClauseModel.ts` — pure general recurrence-clause recognition for biweekly/every-other, every-N, ordinal-weekday, and standalone-frequency phrases
- `useCalendarEventTitleComposer.ts` — title input debounce/flush, Chrono readiness, parse projection, structured-seed initial parser suppression, and uncontrolled-input synchronization

### Schedule + recurrence
- `CalendarEventCompactSchedulePicker.tsx` — compact month + time picker
- `calendarCompactSchedulePickerModel.ts` — month grid generation and range logic
- `CalendarRecurrenceSection.tsx` — full recurrence rule builder
- `CalendarEventRecurrencePicker.tsx` — recurrence presets plus advanced options
- `CalendarRecurringScopePrompt.tsx` — scope chooser (this/following/all) for recurring edits
- `useEventRecurrenceDraft.ts` — recurrence-draft sub-machine (draft + manual-override state, per-field/preset/weekday updates) lifted from useCalendarEventEditor; wraps normalize/validateRecurrenceDraft in calendarEventEditorModel

### Notes, reminders, location, source
- `CalendarEventNotesField.tsx` — description textarea with compact collapse
- `CalendarEventReminderChips.tsx` — fixed reminder chips plus occurrence-scoped Time-to-Leave status, buffer, and removal controls
- `calendarEventReminderModel.ts` — fixed offsets/presets plus Time-to-Leave eligibility, create payload, and grounded display projection
- `useEventReminderDrafts.ts` — fixed/dynamic reminder-draft sub-machine, including optimistic Time-to-Leave removal rollback
- `CalendarLocationSuggestionsPanel.tsx` — Places autocomplete results with keyboard nav
- `useCalendarLocationSuggestions.ts` — async Places fetching with session tokens
- `CalendarSourcePickerPanel.tsx` — account/calendar selector with grouping
- `useCalendarSources.ts` — lazy-loads writable calendar list

### Batch + quick actions
- `CalendarBatchReviewSection.tsx` — review/edit multiple one-off drafts before creation
- `CalendarEventCompactCorrectionToolbar.tsx` — quick per-draft adjustments in batch mode
- `CalendarDraftPreviewPanel.tsx` — read-only draft summary with conflict count
- `CalendarQuickActionLayer.tsx` — portal context menu for duplication and shortcuts
- `useCalendarQuickActions.ts` — stable drag, prompt, context-menu, selection, and clipboard coordinator
- `useCalendarEventQuickActionMutations.ts` — optimistic reschedule/delete/clone/paste/color mutation lifecycles, shared create-race tracking, rollback, and stale-range marking
- `calendarQuickActionModel.ts` — pure reschedule/clone/paste/color/delete payload + date-math builders (DST-safe, Pacific epoch) consumed by `useCalendarQuickActions.ts`
- `quickActionColorModel.ts` — pure color-id resolution + check-icon contrast for the quick-action color grid
- `quickActionMenuLayout.ts` — viewport-clamped menu positioning (`clampMenuPosition`, shared with the deadline quick-action menu in `views/deadlines/`) + focus/roving/tab helpers for the quick-action context menu (focus logic wired through `useDismissablePortal`)

### Selection
- `calendarEventSelectionModel.ts` — selection eligibility checks and identity keys

### Shared test infrastructure
- `CalendarEventEditor.test-utils.tsx` — narrow real-hook + editor-rail harness for editor behavior that does not require the calendar controller, grid, or shell

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Draft model is separate from the persisted event model; normalization lives in `calendarEventEditorModel.ts`.
- Pickers anchor to fields via ref chaining; visibility is owned by `useCalendarEditorPickers.ts`.
- Pacific timezone is hardcoded for date operations, matching the server.

## Related

- `src/hooks/calendar/useFloatingEditorRouting.ts` — routes between detail and this editor
- `server/calendar/calendar-mutations.ts` — backend CRUD these actions call
