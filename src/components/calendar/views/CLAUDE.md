# Calendar Views Map

Per-domain view layers for the calendar modal: events, bills, and deadlines each supply cell content, agenda rails, detail rails, and footers; `agenda/` holds the shared rail shell and mini calendar. Entry points are the view objects `eventsView.tsx` and `billsView.tsx`, which bundle a domain's compute/detail/footer/header exports.

## Files

### Top-level
- `eventsView.tsx` — events view object: weather integration, deadline overlay merging
- `calendarViewTypes.ts` — shared typed view, item, computed-data, and weather contracts
- `billsView.tsx` — bills view object: compute/detail/footer/header bundle
- `EventsHeaderExtras.tsx` — events/deadlines overlay visibility toggles

### agenda (shared rail infrastructure)
- `agenda/AgendaRailShell.tsx` — scrollable rail container with focus and row navigation
- `agenda/AgendaMonthScrollContainer.tsx` — multi-month rail scroller: section registration, topmost-date walk, entry anchor, passive-sync emission
- `agenda/MiniCalendar.tsx` — month picker with day markers and counts
- `agenda/agendaDateModel.ts` — date grouping, month bounds, header label formatting
- `agenda/miniCalendarModel.ts` — mini-calendar cells, marker colors, item dedup

### events
- `events/EventsAgendaRail.tsx` — multi-month timeline orchestration, scroll shell, and shared agenda state
- `events/EventsAgendaMonthSection.tsx` — memoized month/date sections with headers, event/deadline rows, preview forwarding, and drag/drop
- `events/EventsAgendaRailParts.tsx` — weather header and skeleton loader
- `events/EventsAgendaEventRows.tsx` — all-day and timed event rows with location/reminders
- `events/EventsAgendaDeadlineRow.tsx` — task-like agenda row with deadline status and the shared in-place Done receipt
- `events/EventsCellContent.tsx` — event chips in grid cells, multi-day span handling
- `events/EventsDetailRail.tsx` — event detail panel: duration, location, reminders, attendees
- `events/EventSelectedCard.tsx` — selected-event hero card (title/time/meta chips); shared by the detail rail and the dashboard glance sheet
- `events/eventsAgendaModel.ts` — event → agenda conversion, date range clamping
- `events/eventsPlanningModel.ts` — deadline overlay merging and planning item ordering
- `events/eventsAgendaColor.ts` — hex → rgba and contrast text selection
- `events/eventDetailModel.ts` — pure event-detail transforms (title sanitize, time range, meta, accent, Google-calendar action url); shared by the card, detail rail, and dashboard glance sheet

### bills
- `bills/BillsAgendaRail.tsx` — bill timeline grouped by date with utility status
- `bills/BillsCellContent.tsx` — compact bill chips for grid cells
- `bills/BillsDetailRail.tsx` — bill detail panel with schedule link and actions
- `bills/BillSelectedCard.tsx` — selected-bill hero card (name/payee/amount/due/status); shared by the detail rail and the dashboard glance sheet
- `bills/TransactionSelectedCard.tsx` — read-only transaction hero card (direction/amount/date/category/account/notes)
- `bills/UtilityStatusButton.tsx` — tracked utility status pill
- `bills/billsAgendaModel.ts` — bill → agenda conversion, due labels, urgency coloring
- `bills/billsModel.ts` — day state computation, payment tracking, urgency colors
- `bills/utilityStatusModel.ts` — tracked-utility status: best-match selection, paid/stale/honored flags, date labels
- `bills/financeSourceColors.ts` — canonical income/outflow/transfer source colors for every Bills-view surface

### deadlines
- `deadlines/DeadlinesCellContent.tsx` — deadline ghost descriptors reused by Events cells
- `deadlines/DeadlinesDetailRail.tsx` — task detail panel: status, reminders, actions
- `deadlines/DeadlineDetailCard.tsx` — task card with metadata, reminders, and the shared Done receipt; action dock retains disabled/loading feedback
- `deadlines/DeadlineDetailActions.tsx` — mark-complete, edit, delete, link menu
- `deadlines/DeadlineQuickActionLayer.tsx` — context menu for quick actions
- `deadlines/DeadlineStatusIndicator.tsx` — status badge icon
- `deadlines/deadlineDetailModel.ts` — task formatting, priority/context labels, compression
- `deadlines/deadlinesModel.ts` — status normalization, priority colors, source resolution
- `deadlines/calendarDeadlineRescheduleModel.ts` — pure drag-reschedule target resolution + day-only payload (re-supplies `due_time`) + drag-eligibility gate
- `deadlines/useDeadlineQuickActions.ts` — quick-action menu building and handlers, plus the day-only drag-reschedule slice

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Model files export pure transforms from domain data to display descriptors; components stay thin.
- Cell content components measure layout tiers and delegate overflow to `CalendarCellItemStack` in `../modal/`.
- Color precedence: deadline color > source color > default.
- Bills-view day ledgers order unpaid bills, paid bills, inflows, then outflows; transactions stay read-only.

## Related

- `src/components/calendar/modal/` — grid/shell these views plug into (see its map)
- `src/hooks/calendar/` — controller state that selects the active view
