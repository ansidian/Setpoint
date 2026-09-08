import { useNavigate } from 'react-router';
import { financesHref } from '../finances/financesNavigation';
import { useCallback, useLayoutEffect, useState } from "react";
import {
  dashboardDeadlineCalendarRequest,
  dashboardEventCalendarRequest,
  nextItemSheet,
} from "./dashboardShellModel";
import type { DashboardGlanceSheet, DashboardTab, CalendarOpenOptions } from "./dashboardShellModel";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";

type OpenCalendar = (view: "events" | "bills", date?: string | null, itemId?: string | null, options?: CalendarOpenOptions) => void;
interface DashboardSheetRecord extends Record<string, unknown> { id?: string | number }

export default function useDashboardItemSheet({ tab, openCalendar }: { tab: DashboardTab; openCalendar: OpenCalendar }) {
  const navigate = useNavigate();
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

  const openBillInFinances = useCallback((date?: string | null, itemId?: string | number | null) => {
    const scheduleId = String(itemId || '').replace(/^bill:/,'').replace(/:\d{4}-\d{2}-\d{2}$/, '');
    navigate(financesHref(scheduleId ? { view:'schedule',scheduleId,date:date || undefined } : { view:'utilities' }));
  }, [navigate]);

  const openEventInCalendar = useCallback((date?: string | null, itemId?: string | number | null) => {
    const request = dashboardEventCalendarRequest(date, itemId);
    openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
  }, [openCalendar]);

  const openBill = useCallback((date: string | null, itemId: string | number | null, item?: DashboardSheetRecord | null, anchor?: unknown) => {
    if (!item) {
      openBillInFinances(date, itemId);
      return;
    }
    setItemSheet((current) => nextItemSheet(current, {
      kind: "bill",
      item,
      date,
      itemId,
      anchorRef: { current: anchor || null },
    }));
  }, [openBillInFinances]);

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
      openBillInFinances(sheet.date, sheet.itemId);
    } else {
      openEventInCalendar(sheet.date, sheet.itemId);
    }
  }, [close, openBillInFinances, openCalendar, openEventInCalendar]);

  return {
    itemSheet,
    close,
    openDeadline,
    openBill,
    openEvent,
    openInCalendar,
  };
}
