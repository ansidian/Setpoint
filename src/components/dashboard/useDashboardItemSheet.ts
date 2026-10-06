import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  dashboardDeadlineCalendarRequest,
  dashboardEventCalendarRequest,
  nextItemSheet,
} from "./dashboardShellModel";
import type { DashboardGlanceSheet, DashboardTab, CalendarOpenOptions } from "./dashboardShellModel";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";

import type { NeedsYouEmail } from "./needsYou/needsYouModel";

type OpenCalendar = (view: "events", date?: string | null, itemId?: string | null, options?: CalendarOpenOptions) => void;
interface DashboardSheetRecord extends Record<string, unknown> { id?: string | number }

export default function useDashboardItemSheet({ tab, isMobile, openCalendar }: { tab: DashboardTab; isMobile: boolean; openCalendar: OpenCalendar }) {
  const [itemSheet, setItemSheet] = useState<DashboardGlanceSheet | null>(null);
  const editorDirtyRef = useRef(false);
  const setEditorDirty = useCallback((dirty: boolean) => { editorDirtyRef.current = dirty; }, []);
  const close = useCallback(() => setItemSheet(null), []);

  // The sheet portal is anchored inside the Activity-frozen dashboard subtree.
  // Close it before paint when another tab hides that anchor, or the floating
  // panel would briefly reposition against a zero-sized rectangle.
  useLayoutEffect(() => {
    if (tab === "dashboard" && !(isMobile && itemSheet?.kind === "email")) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemSheet((current) => (current ? null : current));
  }, [isMobile, itemSheet?.kind, tab]);

  const openDeadline = useCallback((task: DashboardDeadline, anchor?: unknown) => {
    if (editorDirtyRef.current) return;
    setItemSheet((current) => nextItemSheet(current, {
      kind: "deadline",
      item: task,
      anchorRef: { current: anchor || null },
    }));
  }, []);

  const openEmail = useCallback((email: NeedsYouEmail, anchor?: HTMLElement) => {
    if (editorDirtyRef.current) return;
    const uid = email.uid ?? email.email_id ?? email.id;
    if (uid == null) return;
    setItemSheet((current) => nextItemSheet(current, {
      kind: "email",
      item: { ...email, id: String(email.id ?? uid), uid },
      itemId: `${email.account_id ?? ""}:${uid}`,
      anchorRef: { current: anchor || null },
    }));
  }, []);

  const openEventInCalendar = useCallback((date?: string | null, itemId?: string | number | null) => {
    const request = dashboardEventCalendarRequest(date, itemId);
    openCalendar(request.viewKey, request.focusDate, request.focusItemId, request.options);
  }, [openCalendar]);

  const openEvent = useCallback((date: string | null, itemId: string | number | null, item?: DashboardSheetRecord | null, anchor?: unknown) => {
    if (editorDirtyRef.current) return;
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
    } else if (sheet.kind === "event") {
      openEventInCalendar(sheet.date, sheet.itemId);
    }
  }, [close, openCalendar, openEventInCalendar]);

  return {
    itemSheet,
    setEditorDirty,
    close,
    openDeadline,
    openEmail,
    openEvent,
    openInCalendar,
  };
}
