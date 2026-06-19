# Calendar Modal Map

The calendar modal's structural layer: month grid, day cells with chip stacks and overflow, multi-day span lanes, floating detail panel, and the three-rail shell (search / grid / context). Entry point is `CalendarModalShell.jsx`; state arrives from `src/hooks/calendar/` controllers via `buildCalendarModalShellProps.js`.

## Files

### Shell + header
- `CalendarModalShell.jsx` — three-rail in-flow layout (calendar tab fill), floating detail
- `CalendarModalHeader.jsx` — month/year title, view toggle, search, close
- `CalendarJumpToMonth.jsx` — month/year jump picker popover with crossfade transitions
- `CalendarModalTexture.jsx` — decorative noise overlay
- `buildCalendarModalShellProps.js` — adapter: controller bundles → shell props contract
- `buildContextContent.jsx` — context-rail content router (editor/detail/empty/summary)

### Grid + cells
- `CalendarScrollContainer.jsx` — infinite multi-month scroll viewport: grid stacking, settle-driven week-row alignment (no native CSS snap — it fights Windows wheel input), boundary stepping
- `CalendarGrid.jsx` — month grid orchestration: cells, overlays, selection handlers
- `CalendarGridCells.jsx` — renders day cells, derives per-cell state
- `CalendarCell.jsx` — single day cell: styling, header, weather, drag-drop targets
- `CalendarGridWeekHeader.jsx` — weekday header row
- `CalendarGridLayers.jsx` — overlay compositor: spans, boundaries, inline overflow, skeleton
- `CalendarGridSkeleton.jsx` — initial-load placeholder
- `CalendarSelectedCellFrame.jsx` — selected-cell content wrapper
- `calendarGridUtils.js` — grid constants, month cell builder, boundary helpers
- `calendarGridCellModel.js` — per-cell derived state: filtering, overdue/complete status
- `calendarMonthPreviewModel.js` — preview entries for mounted non-active months, reused while inputs are unchanged

### Chips, stacks, overflow
- `CalendarCellItemChip.jsx` — item chip button with metrics-driven sizing
- `CalendarCellItemChipModel.js` — chip label compacting, leading-column width estimation
- `CalendarCellItemStack.jsx` — visible/hidden item split with layout measurement
- `CalendarCellItemStackModel.js` — stack height calculation and visibility split
- `calendarCellItemMetrics.js` — per-tier item capacity for cells
- `CalendarCellOverflowPopover.jsx` — portal popover for hidden items
- `CalendarCellOverflowPopover.position.js` — popover viewport clamping from trigger rect
- `CalendarInlineOverflowLayer.jsx` — inline overflow panel when space permits
- `useCalendarGridOverflow.js` — overflow state machine: popover vs inline, reanchor on scroll

### Spans + boundaries
- `CalendarEventSpanOverlay.jsx` — multi-day events as pinned row-spanning segments
- `calendarEventSpanLayout.js` — span lane allocation, segment splitting, lane height single-source

### Floating detail
- `CalendarFloatingDetailPanel.jsx` — anchored floating panel: drag, resize response
- `CalendarFloatingDetailCaret.jsx` — anchored caret triangle pointing back to the source cell
- `CalendarFloatingDetailCloseButton.jsx` — close control shared by detail and editor headers
- `CalendarFloatingDetailContent.jsx` — routes detail/editor for deadlines vs events
- `calendarFloatingDetailPlacement.js` — anchor placement with viewport clamping and side flip

### Rails
- `CalendarSearchRail.jsx` — left rail: search input, date-grouped results, keyboard nav
- `CalendarSearchRailParts.jsx` — search result rows, date headers, skeletons
- `CalendarModalContextRail.jsx` — right rail container for detail/editor/agenda
- `CalendarModalAgendaRailContent.jsx` — agenda list entry for the right rail
- `AnimatedRailContent.jsx` — motion wrapper for rail content swaps

### Effects
- `useCalendarGridEffects.js` — wheel month nav, escape/outside overflow close, anchor refresh

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Metrics-driven sizing: chip heights and visible counts adapt to layout tier (uhd/xl/lg/md/sm).
- Components are props-heavy and mostly stateless; derived state comes from the cell/stack models.
- Span lane height/gap constants are single-sourced in `calendarEventSpanLayout.js` — don't duplicate.
- Calendar focus ring uses `data-calendar-focus-ring="true"`.

## Related

- `src/hooks/calendar/` — controller/selection/search state feeding this layer (see its map)
- `src/components/calendar/views/` — per-domain cell/rail content rendered inside the grid
