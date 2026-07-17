import { useCallback, useLayoutEffect, useState } from "react";
import {
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
  nextItemSheet,
} from "./dashboardShellModel";
import type { DashboardGlanceSheet, DashboardTab, CalendarOpenOptions } from "./dashboardShellModel";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";

type OpenCalendar = (view: "events" | "bills", date?: string | null, itemId?: string | null, options?: CalendarOpenOptions) => void;
interface DashboardSheetRecord extends Record<string, unknown> { id?: string | number }

export default function useDashboardItemSheet({ tab, openCalendar }: { tab: DashboardTab; openCalendar: OpenCalendar }) {
  const [itemSheet, setItemSheet] = useState<DashboardGlanceSheet | null>(null);
  const close = useCallback(() => setItemSheet(null), []);

  // The sheet portal is anchored inside the Activity-frozen dashboard subtree.
  // Close it before paint when another tab hides that anchor, or the floating
  // panel would briefly reposition against a zero-sized rectangle.
  useLayoutEffect(() => {
    if (tab === "dashboard") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemSheet((current) => (current ? null : current));
  }, [tab]);

  const openDeadline = useCallback((task: DashboardDeadline, anchor?: unknown) => {
    setItemSheet((current) => nextItemSheet(current, {
      kind: "deadline",
      item: task,
      anchorRef: { current: anchor || null },
    }));
  }, []);

  const openBillInCalendar = useCallback((date?: string | null, itemId?: string | number | null) => {
    const request = dashboardBillCalendarRequest(date, itemId);
    openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
  }, [openCalendar]);

  const openEventInCalendar = useCallback((date?: string | null, itemId?: string | number | null) => {
    openCalendar("events", date || null, itemId ? String(itemId) : null, {
      source: "dashboard",
      openDetail: !!itemId && itemId !== "new",
      forceEventOverlay: !!itemId && itemId !== "new",
    });
  }, [openCalendar]);

  const openBill = useCallback((date: string | null, itemId: string | number | null, item?: DashboardSheetRecord | null, anchor?: unknown) => {
    if (!item) {
      openBillInCalendar(date, itemId);
      return;
    }
    setItemSheet((current) => nextItemSheet(current, {
      kind: "bill",
      item,
      date,
      itemId,
      anchorRef: { current: anchor || null },
    }));
  }, [openBillInCalendar]);

  const openEvent = useCallback((date: string | null, itemId: string | number | null, item?: DashboardSheetRecord | null, anchor?: unknown) => {
    if (!item) {
      openEventInCalendar(date, itemId);
      return;
    }
    setItemSheet((current) => nextItemSheet(current, {
      kind: "event",
      item,
      date,
      itemId,
      anchorRef: { current: anchor || null },
    }));
  }, [openEventInCalendar]);

  const openInCalendar = useCallback((sheet: DashboardGlanceSheet | null) => {
    // Closing first keeps the dashboard-owned portal from surviving the tab
    // switch initiated by openCalendar.
    close();
    if (!sheet) return;
    if (sheet.kind === "deadline") {
      if (!sheet.item) return;
      const request = dashboardDeadlineCalendarRequest(sheet.item as DashboardDeadline);
      openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
    } else if (sheet.kind === "bill") {
      openBillInCalendar(sheet.date, sheet.itemId);
    } else {
      openEventInCalendar(sheet.date, sheet.itemId);
    }
  }, [close, openBillInCalendar, openCalendar, openEventInCalendar]);

  return {
    itemSheet,
    close,
    openDeadline,
    openBill,
    openEvent,
    openInCalendar,
  };
}
