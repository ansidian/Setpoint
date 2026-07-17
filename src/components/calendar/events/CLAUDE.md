# Calendar Events Map

Event creation and editing: the editor rail, natural-language title parsing, recurrence/reminder/location pickers, batch drafts, and recurring-scope prompts. Entry points are `useCalendarEventEditor.ts` (state orchestration) and `CalendarEventEditorRail.tsx` (UI composition).

## Files

### Editor core
- `useCalendarEventEditor.ts` — orchestrates editor state, validation, persistence, lifecycle
- `useCalendarEditorPickers.ts` — floating panel visibility and field anchor refs
- `calendarEventEditorModel.ts` — draft normalization, validation, recurrence serialization, batch ops
- `calendarEventEditorSessionModel.ts` — pure editor-session projections and transitions (validation visibility, title-assist draft sync, source seeding, batch edits)
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
- `calendarTitleIntent.ts` — classifies title intent: batch, recurring, single
- `useCalendarEventTitleComposer.ts` — title input debounce/flush, Chrono readiness, parse projection, and uncontrolled-input synchronization

### Schedule + recurrence
- `CalendarEventCompactSchedulePicker.tsx` — compact month + time picker
- `calendarCompactSchedulePickerModel.ts` — month grid generation and range logic
- `CalendarRecurrenceSection.tsx` — full recurrence rule builder
- `CalendarEventRecurrencePicker.tsx` — recurrence presets plus advanced options
- `CalendarRecurringScopePrompt.tsx` — scope chooser (this/following/all) for recurring edits
- `useEventRecurrenceDraft.ts` — recurrence-draft sub-machine (draft + manual-override state, per-field/preset/weekday updates) lifted from useCalendarEventEditor; wraps normalize/validateRecurrenceDraft in calendarEventEditorModel

### Notes, reminders, location, source
- `CalendarEventNotesField.tsx` — description textarea with compact collapse
- `CalendarEventReminderChips.tsx` — reminder chips with status badges and removal
- `calendarEventReminderModel.ts` — reminder offsets, presets, sent-status tracking
- `useEventReminderDrafts.ts` — reminder-draft sub-machine (drafts, removal ids, custom picker state, preset states memo) lifted from useCalendarEventEditor; wraps calendarEventReminderModel
- `CalendarLocationSuggestionsPanel.tsx` — Places autocomplete results with keyboard nav
- `useCalendarLocationSuggestions.ts` — async Places fetching with session tokens
- `CalendarSourcePickerPanel.tsx` — account/calendar selector with grouping
- `useCalendarSources.ts` — lazy-loads writable calendar list

### Batch + quick actions
- `CalendarBatchReviewSection.tsx` — review/edit multiple one-off drafts before creation
- `CalendarEventCompactCorrectionToolbar.tsx` — quick per-draft adjustments in batch mode
- `CalendarDraftPreviewPanel.tsx` — read-only draft summary with conflict count
- `CalendarQuickActionLayer.tsx` — portal context menu for duplication and shortcuts
- `useCalendarQuickActions.ts` — clipboard paste, cloning, quick-create workflows
- `calendarQuickActionModel.ts` — pure reschedule/clone/paste/color/delete payload + date-math builders (DST-safe, Pacific epoch) consumed by `useCalendarQuickActions.ts`
- `quickActionColorModel.ts` — pure color-id resolution + check-icon contrast for the quick-action color grid
- `quickActionMenuLayout.ts` — viewport-clamped menu positioning (`clampMenuPosition`, shared with the deadline quick-action menu in `views/deadlines/`) + focus/roving/tab helpers for the quick-action context menu (focus logic wired through `useDismissablePortal`)

### Selection
- `calendarEventSelectionModel.ts` — selection eligibility checks and identity keys

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Draft model is separate from the persisted event model; normalization lives in `calendarEventEditorModel.ts`.
- Pickers anchor to fields via ref chaining; visibility is owned by `useCalendarEditorPickers.ts`.
- Pacific timezone is hardcoded for date operations, matching the server.

## Related

- `src/hooks/calendar/useFloatingEditorRouting.ts` — routes between detail and this editor
- `server/calendar/calendar-mutations.ts` — backend CRUD these actions call
