// Event and deadline targets open Calendar; email targets open the panel-local preview.
import {
  dashboardDeadlineCalendarRequest,
} from "../dashboard/dashboardShellModel";
import { pacificYMD } from "../calendar/calendarDateUtils";
import type { AlfredEmailItem, AlfredItemKind } from "../../../shared/types/alfred";
import type { CalendarOpenRequest } from "../dashboard/dashboardShellModel";

export type AlfredChipAction =
  | { type: "email"; item: AlfredEmailItem }
  | { type: "calendar"; request: CalendarOpenRequest };

export function resolveAlfredChipAction(
  kind: AlfredItemKind,
  item: Record<string, unknown> | null | undefined,
): AlfredChipAction | null {
  if (!item) return null;
  if (kind === "email") {
    return item.uid ? { type: "email", item: item as AlfredEmailItem } : null;
  }
  if (kind === "event") {
    if (!item.id) return null;
    return {
      type: "calendar",
      request: {
        viewKey: "events",
        // Normalized Google events carry epoch ms, not an ISO date (dayLabel
        // is a display string); derive the Pacific day the calendar grids use.
        focusDate: Number.isFinite(item.startMs) ? pacificYMD(Number(item.startMs)) : null,
        focusItemId: String(item.id),
        options: { source: "alfred", openDetail: true, forceEventOverlay: true },
      },
    };
  }
  if (kind === "deadline") {
    if (!item.id) return null;
    return { type: "calendar", request: dashboardDeadlineCalendarRequest(item) };
  }
  return null;
}
