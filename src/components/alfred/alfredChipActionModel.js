// Maps a clicked Alfred chip (kind + verbatim domain row) to a navigation
// action: email rows open the read-only preview overlay; event/deadline/bill
// rows become calendar requests. Calendar requests reuse the dashboard's
// builders so Alfred deep-links behave exactly like dashboard rail clicks
// (deadline occurrence ids, completed-deadline overlay, bills-view fallback).
// Pure: no React (docs/exec-plans/active/2026-06-12-alfred-clickable-chips.md).
import {
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
} from "../dashboard/dashboardShellModel.js";
import { pacificYMD } from "../calendar/calendarDateUtils.js";

export function resolveAlfredChipAction(kind, item) {
  if (!item) return null;
  if (kind === "email") {
    return item.uid ? { type: "email", item } : null;
  }
  if (kind === "event") {
    if (!item.id) return null;
    return {
      type: "calendar",
      request: {
        viewKey: "events",
        // Normalized Google events carry epoch ms, not an ISO date (dayLabel
        // is a display string); derive the Pacific day the calendar grids use.
        focusDate: Number.isFinite(item.startMs) ? pacificYMD(item.startMs) : null,
        focusItemId: item.id,
        options: { source: "alfred", openDetail: true, forceEventOverlay: true },
      },
    };
  }
  if (kind === "deadline") {
    if (!item.id) return null;
    return { type: "calendar", request: dashboardDeadlineCalendarRequest(item) };
  }
  if (kind === "bill") {
    // openActionDisabled (e.g. a paid occurrence) means the bills view offers no
    // open action, so a chip click would dead-end — leave it non-interactive.
    if (!item.id || item.openActionDisabled) return null;
    return { type: "calendar", request: dashboardBillCalendarRequest(item.next_date, item.id) };
  }
  return null;
}
