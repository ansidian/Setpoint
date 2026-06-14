# Calendar Events Map

Event creation and editing: the editor rail, natural-language title parsing, recurrence/reminder/location pickers, batch drafts, and recurring-scope prompts. Entry points are `useCalendarEventEditor.js` (state orchestration) and `CalendarEventEditorRail.jsx` (UI composition).

## Files

### Editor core
- `useCalendarEventEditor.js` — orchestrates editor state, validation, persistence, lifecycle
- `useCalendarEditorPickers.js` — floating panel visibility and field anchor refs
- `calendarEventEditorModel.js` — draft normalization, validation, recurrence serialization, batch ops
- `calendarEventEditorActions.js` — CRUD/reminder API calls and error formatting
- `calendarEditorUtils.js` — date/time formatting, style constants, field helpers

### Editor UI
- `CalendarEventEditorRail.jsx` — root editor layout combining sub-panels with animations
- `CalendarEventEditorPanels.jsx` — floating date/time/location/source/recurrence pickers
- `CalendarEventEditorHeader.jsx` — mode label and contextual copy (editing/batch/new)
- `CalendarEventEditorActionBar.jsx` — save/delete/cancel with confirmation states
- `CalendarEventEditorStatusMessages.jsx` — error and validation messaging
- `CalendarEditorControls.jsx` — shared editor control primitives

### Title + intent
- `CalendarEventTitleField.jsx` — title input with placeholder hints
- `CalendarEventTitleAssistPanel.jsx` — parsed location/calendar queries from the title
- `parseCalendarTitle.js` — natural-language date/time extraction (Chrono, weekday patterns)
- `calendarTitleIntent.js` — classifies title intent: batch, recurring, single

### Schedule + recurrence
- `CalendarEventCompactSchedulePicker.jsx` — compact month + time picker
- `calendarCompactSchedulePickerModel.js` — month grid generation and range logic
- `CalendarRecurrenceSection.jsx` — full recurrence rule builder
- `CalendarEventRecurrencePicker.jsx` — recurrence presets plus advanced options
- `CalendarRecurringScopePrompt.jsx` — scope chooser (this/following/all) for recurring edits

### Notes, reminders, location, source
- `CalendarEventNotesField.jsx` — description textarea with compact collapse
- `CalendarEventReminderChips.jsx` — reminder chips with status badges and removal
- `calendarEventReminderModel.js` — reminder offsets, presets, sent-status tracking
- `CalendarLocationSuggestionsPanel.jsx` — Places autocomplete results with keyboard nav
- `useCalendarLocationSuggestions.js` — async Places fetching with session tokens
- `CalendarSourcePickerPanel.jsx` — account/calendar selector with grouping
- `useCalendarSources.js` — lazy-loads writable calendar list

### Batch + quick actions
- `CalendarBatchReviewSection.jsx` — review/edit multiple one-off drafts before creation
- `CalendarEventCompactCorrectionToolbar.jsx` — quick per-draft adjustments in batch mode
- `CalendarDraftPreviewPanel.jsx` — read-only draft summary with conflict count
- `CalendarQuickActionLayer.jsx` — portal context menu for duplication and shortcuts
- `useCalendarQuickActions.js` — clipboard paste, cloning, quick-create workflows

### Selection
- `calendarEventSelectionModel.js` — selection eligibility checks and identity keys

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Draft model is separate from the persisted event model; normalization lives in `calendarEventEditorModel.js`.
- Pickers anchor to fields via ref chaining; visibility is owned by `useCalendarEditorPickers.js`.
- Pacific timezone is hardcoded for date operations, matching the server.

## Related

- `src/hooks/calendar/useFloatingEditorRouting.js` — routes between detail and this editor
- `server/calendar/calendar-mutations.js` — backend CRUD these actions call
