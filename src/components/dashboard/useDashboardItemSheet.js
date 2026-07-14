import { useCallback, useLayoutEffect, useState } from "react";
import {
  dashboardBillCalendarRequest,
  dashboardDeadlineCalendarRequest,
  nextItemSheet,
} from "./dashboardShellModel.js";

export default function useDashboardItemSheet({ tab, openCalendar }) {
  const [itemSheet, setItemSheet] = useState(null);
  const close = useCallback(() => setItemSheet(null), []);

  // The sheet portal is anchored inside the Activity-frozen dashboard subtree.
  // Close it before paint when another tab hides that anchor, or the floating
  // panel would briefly reposition against a zero-sized rectangle.
  useLayoutEffect(() => {
    if (tab === "dashboard") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemSheet((current) => (current ? null : current));
  }, [tab]);

  const openDeadline = useCallback((task, anchor) => {
    setItemSheet((current) => nextItemSheet(current, {
      kind: "deadline",
      item: task,
      anchorRef: { current: anchor || null },
    }));
  }, []);

  const openBillInCalendar = useCallback((date, itemId) => {
    const request = dashboardBillCalendarRequest(date, itemId);
    openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
  }, [openCalendar]);

  const openEventInCalendar = useCallback((date, itemId) => {
    openCalendar("events", date || null, itemId, {
      source: "dashboard",
      openDetail: !!itemId && itemId !== "new",
      forceEventOverlay: !!itemId && itemId !== "new",
    });
  }, [openCalendar]);

  const openBill = useCallback((date, itemId, item, anchor) => {
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

  const openEvent = useCallback((date, itemId, item, anchor) => {
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

  const openInCalendar = useCallback((sheet) => {
    // Closing first keeps the dashboard-owned portal from surviving the tab
    // switch initiated by openCalendar.
    close();
    if (!sheet) return;
    if (sheet.kind === "deadline") {
      const request = dashboardDeadlineCalendarRequest(sheet.item);
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
