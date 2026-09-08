// Exact financial targets open Finances; event and deadline targets open Calendar.
import {
  dashboardDeadlineCalendarRequest,
} from "../dashboard/dashboardShellModel";
import { pacificYMD } from "../calendar/calendarDateUtils";
import type { AlfredEmailItem, AlfredItemKind } from "../../../shared/types/alfred";
import type { CalendarOpenRequest } from "../dashboard/dashboardShellModel";

import type { FinanceDestination } from "../finances/financesNavigation";

export type AlfredChipAction =
  | { type: "finances"; target: FinanceDestination }
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
  if (kind === "bill") {
    if (!item.id) return null;
    return { type: "finances", target: { view: "schedule", scheduleId: String(item.scheduleId || item.id).replace(/:\d{4}-\d{2}-\d{2}$/, ""), date: typeof item.next_date === "string" ? item.next_date : undefined } };
  }
  if (kind === "transaction") {
    if (!item.id || typeof item.date !== "string") return null;
    return { type: "finances", target: { view: "journal", transactionId: String(item.id), date: item.date } };
  }
  return null;
}
