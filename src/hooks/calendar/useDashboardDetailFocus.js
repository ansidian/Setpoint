import { useEffect, useRef } from "react";
import { parseYmd } from "../../components/calendar/calendarDateUtils.js";
import useDashboardFocusRetry from "./useDashboardFocusRetry.js";
import { dashboardDetailFocusRequest } from "./calendarModalInteractionModel.js";
import {
  findGridChipAnchor,
  itemDueDate,
  itemFromCalendarSearchResult,
  resolvePendingFocusItem,
} from "./calendarControllerHelpers.js";

// Dashboard-detail focus-retry machine, extracted from useCalendarModalController
// as part of the god-component split (mirrors useCalendarDeadlineOverlay /
// calendarControllerHelpers). Owns the per-request derivation effect, the single
// attach attempt, the retry-loop wiring, and the two private refs that back them.
//
// The pendingItemDetailFocus state stays in the controller: the search-activation
// path (activateCalendarSearchResult) also enqueues into the same machine and is
// declared before this hook can run (it needs `computed` from the view model), so
// moving the state here would create a forward reference. Its value and setter are
// passed in instead. Behavior is identical to the previous inline version — same
// effects, same dep arrays, same one-frame agenda deferral.
export default function useDashboardDetailFocus({
  open,
  view,
  focusOpenDetail,
  focusItemId,
  focusDate,
  openRequestId,
  forceDeadlineOverlay,
  usesFloatingEditor,
  activeView,
  computed,
  activeSelectedDateKey,
  floatingDetailRef,
  panelRef,
  agendaRailRef,
  shakeFloatingEditor,
  suppressAgendaPassiveSync,
  openFloatingDetail,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  pendingItemDetailFocus,
  setPendingItemDetailFocus,
}) {
  const handledDashboardDetailFocusRef = useRef(null);
  const dashboardDetailFocusRafRef = useRef(0);

  useEffect(() => {
    const request = dashboardDetailFocusRequest({
      open,
      focusOpenDetail,
      focusItemId,
      focusDate,
      activeSelectedDateKey,
      openRequestId,
      usesFloatingEditor,
      view,
      forceDeadlineOverlay,
    });
    if (!request) {
      if (!open) {
        setPendingItemDetailFocus(null);
        handledDashboardDetailFocusRef.current = null;
      }
      return;
    }
    if (handledDashboardDetailFocusRef.current === request.requestKey) return;
    setPendingItemDetailFocus((current) => {
      if (
        current?.openRequestId === request.openRequestId
        && current.view === request.view
        && current.detailKind === request.detailKind
        && current.dateKey === request.dateKey
        && current.itemId === request.itemId
      ) {
        return current;
      }
      return request;
    });
    // setPendingItemDetailFocus is the controller's useState setter (stable
    // identity), so listing it here is a no-op vs the original inline effect —
    // it only satisfies exhaustive-deps now that the setter arrives as a prop.
  }, [activeSelectedDateKey, focusDate, focusItemId, focusOpenDetail, forceDeadlineOverlay, open, openRequestId, usesFloatingEditor, view, setPendingItemDetailFocus]);

  // One attach attempt for a pending dashboard-detail focus request. Returns a
  // status the retry scheduler understands: "done" (attached), "abort" (no
  // longer applicable), or "retry" (target not in the DOM yet). The scheduler
  // (useDashboardFocusRetry) owns the 250 ms cadence and give-up counting, so
  // this reads the latest controller state on every poll without re-rendering.
  const attemptDashboardDetailFocus = (request) => {
    const currentDetail = floatingDetailRef.current;
    if (
      currentDetail?.open
      && (currentDetail.mode === "edit" || currentDetail.mode === "create")
      && currentDetail.dirty
    ) {
      shakeFloatingEditor();
      setPendingItemDetailFocus(null);
      return "abort";
    }

    const resolvedItem = resolvePendingFocusItem({
      activeView,
      computed,
      dateKey: request.dateKey,
      itemId: request.itemId,
    });
    const item = resolvedItem || (
      request.anchorKind === "search-result-row"
        ? itemFromCalendarSearchResult(request.searchResult)
        : null
    );
    if (!item) return "retry";

    const resolvedDateKey = itemDueDate(item) || request.dateKey;
    const resolvedItemId = String(
      activeView.getItemId ? activeView.getItemId(item) : item.id,
    );

    if (request.anchorKind === "grid-chip") {
      const anchorElement = findGridChipAnchor(panelRef.current, resolvedItemId, resolvedDateKey);
      if (!anchorElement) return "retry";
      const parsed = parseYmd(resolvedDateKey);
      if (!parsed) {
        setPendingItemDetailFocus(null);
        return "abort";
      }
      suppressAgendaPassiveSync();
      setSelectedDay(parsed.day);
      setSelectedDateKey(resolvedDateKey);
      setSelectedItemId(resolvedItemId != null ? String(resolvedItemId) : null);
      openFloatingDetail({
        mode: "detail",
        view: request.view,
        detailKind: request.detailKind || null,
        itemId: resolvedItemId,
        dateKey: resolvedDateKey,
        day: parsed.day,
        anchorElement,
        sourceCellElement: anchorElement.closest?.("[role='gridcell']") || null,
        anchorKind: "chip",
        itemsSnapshot: [item],
      });
      handledDashboardDetailFocusRef.current = request.requestKey;
      setPendingItemDetailFocus(null);
      return "done";
    }

    if (request.anchorKind === "search-result-row") {
      const anchorElement = request.anchorElement?.isConnected
        ? request.anchorElement
        : null;
      if (!anchorElement) return "retry";
      const parsed = parseYmd(resolvedDateKey);
      if (!parsed) {
        setPendingItemDetailFocus(null);
        return "abort";
      }
      suppressAgendaPassiveSync();
      setSelectedDay(parsed.day);
      setSelectedDateKey(resolvedDateKey);
      setSelectedItemId(resolvedItemId != null ? String(resolvedItemId) : null);
      openFloatingDetail({
        mode: "detail",
        view: request.view,
        detailKind: request.detailKind || null,
        itemId: resolvedItemId,
        dateKey: resolvedDateKey,
        day: parsed.day,
        anchorElement,
        sourceCellElement: request.sourceCellElement?.isConnected
          ? request.sourceCellElement
          : anchorElement,
        anchorKind: "search-result-row",
        itemsSnapshot: [item],
      });
      handledDashboardDetailFocusRef.current = request.requestKey;
      setPendingItemDetailFocus(null);
      return "done";
    }

    // Defer agenda activation by one frame so the rail can lay out before we
    // activate it (prevents a scroll jump). The synchronous call reports
    // "retry" so the scheduler keeps polling until the deferred activation
    // succeeds (which clears the pending request) or the loop gives up.
    window.cancelAnimationFrame(dashboardDetailFocusRafRef.current);
    dashboardDetailFocusRafRef.current = window.requestAnimationFrame(() => {
      suppressAgendaPassiveSync();
      const activated = agendaRailRef.current?.activateItem?.(
        resolvedItemId,
        resolvedDateKey,
      );
      if (!activated) return;
      handledDashboardDetailFocusRef.current = request.requestKey;
      setPendingItemDetailFocus(null);
    });
    return "retry";
  };

  const {
    retryFocus: retryDashboardDetailFocus,
    cancelFocus: cancelDashboardDetailFocus,
  } = useDashboardFocusRetry({
    attempt: attemptDashboardDetailFocus,
    onGiveUp: () => setPendingItemDetailFocus(null),
  });

  useEffect(() => {
    if (!pendingItemDetailFocus || !open || !usesFloatingEditor) return undefined;
    if (pendingItemDetailFocus.view !== view) return undefined;
    retryDashboardDetailFocus(pendingItemDetailFocus);
    return () => {
      cancelDashboardDetailFocus();
      window.cancelAnimationFrame(dashboardDetailFocusRafRef.current);
    };
  }, [
    pendingItemDetailFocus,
    open,
    usesFloatingEditor,
    view,
    retryDashboardDetailFocus,
    cancelDashboardDetailFocus,
  ]);
}
