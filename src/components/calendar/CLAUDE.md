# Calendar Map (router)

Calendar UI root: `CalendarModal.jsx` is the entry point (named for history; the calendar now mounts as a persistent `KeepAliveTab` in `DashboardShell`, not a modal overlay), delegating state to `src/hooks/calendar/` and rendering through the sub-areas below. Root-level files own the rail system (overview/detail panels framing the grid), date/layout utilities, and shared test infrastructure. Do not add calendar files outside this tree or `src/hooks/calendar/`.

## Sub-maps

- `modal/` — grid, cells, chips/overflow, span lanes, floating detail, three-rail shell (see `modal/CLAUDE.md`)
- `events/` — event editor rail, title parsing, recurrence/reminder/location pickers, batch drafts (see `events/CLAUDE.md`)
- `views/` — per-domain cell/agenda/detail/footer layers for events, bills, deadlines (see `views/CLAUDE.md`)

## Files

### Entry + rails
- `CalendarModal.jsx` — entry point delegating to the calendar controller hook
- `CalendarOverviewRail.jsx` — month navigator with stats and loading frame
- `CalendarRailPrimitives.jsx` — reusable rail components and utilities
- `CalendarRailStates.jsx` — rail state transitions: loading, expanded, collapsed
- `CalendarSelectedDayEmptyRail.jsx` — empty state with nearby activity and primary action
- `DetailRailPrimitives.jsx` — hero cards, meta chips, section containers
- `TimelineDetailRail.jsx` — timeline layout with collapsible sections and motion
- `NearbyActivityCard.jsx` — adjacent days' activity with neighbor navigation
- `GoogleSpecialDateBadge.jsx` — birthday/anniversary badge with color customization

### Models + utilities
- `calendarDateUtils.js` — Pacific-timezone date parsing, formatting, manipulation
- `calendarLayout.js` — responsive layout metrics from viewport breakpoints — a **desktop** viewport-width ladder driven by `window.innerWidth` (`useViewportWidth`), independent of the app's mobile gate. The 639px `useIsMobile` gate unmounts the calendar below 639px, so the `sm` fallback tier (a 7-column month grid, 100px cells, no rails/detail) is only ever reached on a desktop window 640–1239px wide — never the phone gate.
- `calendarOverviewModel.js` — month summary stats for the overview rail
- `calendarEmptyStateMeta.js` — per-view (events/bills) labels and icons
- `calendarRailStyles.js` — shared rail container and hero-card styles
- `detailRailMotion.js` — easing curves and transition durations for rails
- `googleSpecialDateModel.js` — identifies Google special dates and their colors
- `reminderDisplay.js` — reminder time formatting and upcoming-state calculation
- `calendarDragSupport.js` — `nativeDragSupported(layout)` gate (desktop + fine-pointer); shared by the event and deadline drag hooks
- `ghostPreview.js` — preview indicators for dragged events/deadlines
- `useCalendarGhostPreview.js` — combined ghost previews with auto-navigation

### Reminders
- `reminders/ReminderDateTimePicker.jsx` — date/time picker for reminder scheduling

### Shared test infrastructure
- `CalendarModal.test-setup.js` — mocks calendar sources and Todoist API
- `CalendarModal.test-utils.jsx` — DashboardProvider wrapper, animation-frame flushing
- `CalendarEventEditor.test-setup.js` — mocks event and reminder API calls
- `CalendarEventEditor.test-utils.jsx` — renders the modal with editor interaction helpers

(Tests are not listed: `X.test.js(x)` covers `X` by convention. `*.test-utils.*` / `*.test-setup.*` ARE listed — shared infra.)

## Related

- `src/hooks/calendar/` — calendar state and models (see its map)
- `src/components/dashboard/DashboardCalendarModalMount.jsx` — where the calendar tab mounts
