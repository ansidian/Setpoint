import { useEffect, useMemo, useRef } from "react";
import {
  buildDeadlineGhostPreview,
  buildEventGhostPreview,
  dateOutsideVisibleGrid,
  monthFromYmd,
} from "./ghostPreview.js";

function combineGhostPreviews(eventGhostPreview, deadlineGhostPreview) {
  if (!eventGhostPreview) return deadlineGhostPreview;
  if (!deadlineGhostPreview) return eventGhostPreview;
  return {
    kind: "mixed",
    targetDate: deadlineGhostPreview.targetDate || eventGhostPreview.targetDate,
    ghosts: [
      ...(eventGhostPreview.ghosts || []),
      ...(deadlineGhostPreview.ghosts || []),
    ],
  };
}

export default function useCalendarGhostPreview({
  open,
  view,
  viewData,
  computed,
  eventEditor,
  deadlineEditor,
  deadlineDraftPreview,
  viewYear,
  viewMonth,
  setMonthMotionDirection,
  setViewDate,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  manualMonthBrowseKey = 0,
}) {
  const autoNavRef = useRef({ lastNavigateAt: 0, lastTargetDate: "" });
  const suppressedAutoNavRef = useRef({ browseKey: manualMonthBrowseKey, ghostSignature: "" });
  const eventGhostPreview = useMemo(() => (
    view === "events"
      ? buildEventGhostPreview({ editor: eventEditor, events: viewData?.events || [] })
      : null
  ), [eventEditor, view, viewData?.events]);
  const deadlineGhostPreview = useMemo(() => {
    if (!["deadlines", "events"].includes(view) || !deadlineEditor?.mode || !deadlineDraftPreview) return null;
    return buildDeadlineGhostPreview({
      draft: deadlineDraftPreview,
      dateItems: computed.itemsByDate?.[deadlineDraftPreview.dueDate],
    });
  }, [computed.itemsByDate, deadlineDraftPreview, deadlineEditor?.mode, view]);
  const ghostPreview = view === "events"
    ? combineGhostPreviews(eventGhostPreview, deadlineGhostPreview)
    : deadlineGhostPreview;
  const ghostSignature = useMemo(() => {
    const ghosts = ghostPreview?.ghosts || [];
    return JSON.stringify(ghosts.map((ghost) => ({
      kind: ghost?.kind,
      startDate: ghost?.startDate,
      endDate: ghost?.endDate,
      startTime: ghost?.startTime,
      endTime: ghost?.endTime,
      dueDate: ghost?.dueDate,
      dueTime: ghost?.dueTime,
      allDay: !!ghost?.allDay,
    })));
  }, [ghostPreview?.ghosts]);

  useEffect(() => {
    const suppressed = suppressedAutoNavRef.current;
    if (suppressed.browseKey === manualMonthBrowseKey) return;
    suppressedAutoNavRef.current = { browseKey: manualMonthBrowseKey, ghostSignature };
  }, [ghostSignature, manualMonthBrowseKey]);

  useEffect(() => {
    if (!open || !ghostPreview?.targetDate || !dateOutsideVisibleGrid(ghostPreview.targetDate, viewYear, viewMonth)) return undefined;
    if (suppressedAutoNavRef.current.ghostSignature === ghostSignature) return undefined;
    const target = ghostPreview.targetDate;
    const timeout = window.setTimeout(() => {
      const nowMs = Date.now();
      const last = autoNavRef.current;
      if (last.lastTargetDate === target && nowMs - last.lastNavigateAt < 1000) return;
      const parsed = monthFromYmd(target);
      if (!parsed) return;
      setMonthMotionDirection((parsed.year * 12 + parsed.month) > (viewYear * 12 + viewMonth) ? 1 : -1);
      setViewDate({ year: parsed.year, month: parsed.month });
      setSelectedDay(parsed.day);
      setSelectedDateKey(target);
      setSelectedItemId(null);
      last.lastNavigateAt = nowMs;
      last.lastTargetDate = target;
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [ghostPreview?.targetDate, ghostSignature, open, setMonthMotionDirection, setSelectedDateKey, setSelectedDay, setSelectedItemId, setViewDate, viewMonth, viewYear]);

  return ghostPreview;
}
