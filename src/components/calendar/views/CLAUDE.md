# Calendar Views Map

Per-domain view layers for the calendar modal: events, bills, and deadlines each supply cell content, agenda rails, detail rails, and footers; `agenda/` holds the shared rail shell and mini calendar. Entry points are the view objects `eventsView.jsx` and `billsView.jsx`, which bundle a domain's compute/detail/footer/header exports.

## Files

### Top-level
- `eventsView.jsx` — events view object: weather integration, deadline overlay merging
- `billsView.jsx` — bills view object: compute/detail/footer/header bundle
- `EventsHeaderExtras.jsx` — events/deadlines overlay visibility toggles

### agenda (shared rail infrastructure)
- `agenda/AgendaRailShell.jsx` — scrollable rail container with focus and row navigation
- `agenda/AgendaMonthScrollContainer.jsx` — multi-month rail scroller: section registration, topmost-date walk, entry anchor, passive-sync emission
- `agenda/MiniCalendar.jsx` — month picker with day markers and counts
- `agenda/agendaDateModel.js` — date grouping, month bounds, header label formatting
- `agenda/miniCalendarModel.js` — mini-calendar cells, marker colors, item dedup

### events
- `events/EventsAgendaRail.jsx` — combined timeline (events + deadline overlays) with weather
- `events/EventsAgendaRailParts.jsx` — weather header and skeleton loader
- `events/EventsAgendaEventRows.jsx` — all-day and timed event rows with location/reminders
- `events/EventsAgendaDeadlineRow.jsx` — task-like agenda row with deadline status
- `events/EventsCellContent.jsx` — event chips in grid cells, multi-day span handling
- `events/EventsDetailRail.jsx` — event detail panel: duration, location, reminders, attendees
- `events/EventsFooter.jsx` — month statistics (count, busy hours)
- `events/eventsAgendaModel.js` — event → agenda conversion, date range clamping
- `events/eventsPlanningModel.js` — deadline overlay merging and planning item ordering
- `events/eventsAgendaColor.js` — hex → rgba and contrast text selection

### bills
- `bills/BillsAgendaRail.jsx` — bill timeline grouped by date with utility status
- `bills/BillsCellContent.jsx` — compact bill chips for grid cells
- `bills/BillsDetailRail.jsx` — bill detail panel with schedule link and actions
- `bills/BillsFooter.jsx` — month bill total badge
- `bills/UtilityStatusButton.jsx` — tracked utility status pill
- `bills/billsAgendaModel.js` — bill → agenda conversion, due labels, urgency coloring
- `bills/billsModel.js` — day state computation, payment tracking, urgency colors
- `bills/utilityStatusModel.js` — tracked-utility status: best-match selection, paid/stale/honored flags, date labels

### deadlines
- `deadlines/DeadlinesAgendaRail.jsx` — task timeline grouped by due date with status
- `deadlines/DeadlinesCellContent.jsx` — compact task chips for grid cells
- `deadlines/DeadlinesDetailRail.jsx` — task detail panel: status, reminders, actions
- `deadlines/DeadlinesFooter.jsx` — month summary: totals, due today/this week
- `deadlines/DeadlinesHeaderExtras.jsx` — new-task button for the selected date
- `deadlines/DeadlineDetailCard.jsx` — task card with metadata and reminders
- `deadlines/DeadlineDetailActions.jsx` — mark-complete, edit, delete, link menu
- `deadlines/DeadlineQuickActionLayer.jsx` — context menu for quick actions
- `deadlines/DeadlineStatusIndicator.jsx` — status badge icon
- `deadlines/deadlineDetailModel.js` — task formatting, priority/context labels, compression
- `deadlines/deadlinesAgendaModel.js` — task → agenda conversion, status/accent mapping
- `deadlines/deadlinesModel.js` — status normalization, priority colors, source resolution
- `deadlines/calendarDeadlineRescheduleModel.js` — pure drag-reschedule target resolution + day-only payload (re-supplies `due_time`) + drag-eligibility gate
- `deadlines/useDeadlineQuickActions.js` — quick-action menu building and handlers, plus the day-only drag-reschedule slice

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Model files export pure transforms from domain data to display descriptors; components stay thin.
- Cell content components measure layout tiers and delegate overflow to `CalendarCellItemStack` in `../modal/`.
- Color precedence: deadline color > source color > default.

## Related

- `src/components/calendar/modal/` — grid/shell these views plug into (see its map)
- `src/hooks/calendar/` — controller state that selects the active view
