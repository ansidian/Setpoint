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

function eventEditorGhostInputSignature(editor) {
  if (!editor?.isEditorOpen) return "";
  const draft = editor.draft || {};
  const mode = editor.intentState?.mode || "single";
  return JSON.stringify({
    isEditorOpen: true,
    draft: {
      accountId: draft.accountId || "",
      calendarId: draft.calendarId || "",
      allDay: !!draft.allDay,
      startDate: draft.startDate || "",
      endDate: draft.endDate || "",
      startTime: draft.startTime || "",
      endTime: draft.endTime || "",
    },
    intentState: { mode },
    batchDrafts: mode === "batch"
      ? (editor.batchDrafts || []).map((item) => ({
          startDate: item?.startDate || "",
          endDate: item?.endDate || "",
          startTime: item?.startTime || "",
          endTime: item?.endTime || "",
        }))
      : [],
    editingEvent: editor.editingEvent
      ? {
          id: editor.editingEvent.id,
          originalStartTime: editor.editingEvent.originalStartTime || "",
          accountId: editor.editingEvent.accountId || "",
          calendarId: editor.editingEvent.calendarId || "",
          allDay: !!editor.editingEvent.allDay,
          isRecurring: !!editor.editingEvent.isRecurring,
          startMs: editor.editingEvent.startMs || null,
          endMs: editor.editingEvent.endMs || null,
        }
      : null,
    recurringEditScope: editor.recurringEditScope || "",
    writableCalendars: (editor.writableCalendars || []).map((entry) => ({
      value: entry?.value || "",
      color: entry?.color || "",
    })),
  });
}

function eventEditorGhostTitles(editor) {
  if (!editor?.isEditorOpen) return [];
  const mode = editor.intentState?.mode || "single";
  if (mode === "batch") {
    return (editor.batchDrafts || []).map((item) => (
      String(item?.title || editor.effectiveTitle || editor.draft?.title || "").trim() || "Untitled"
    ));
  }
  return [String(editor.effectiveTitle || editor.draft?.title || "").trim() || "Untitled"];
}

function applyEventGhostTitles(preview, titles) {
  if (!preview?.ghosts?.length) return preview;
  let changed = false;
  const ghosts = preview.ghosts.map((ghost, index) => {
    const title = titles[index] || titles[0] || "Untitled";
    if (ghost.title === title) return ghost;
    changed = true;
    return { ...ghost, title };
  });
  return changed ? { ...preview, ghosts } : preview;
}

function deadlineGhostInputSignature(draft) {
  if (!draft) return "";
  return JSON.stringify({
    dueDate: draft.dueDate || "",
    dueTime: draft.dueTime || "",
    color: draft.color || "",
    isEditing: !!draft.isEditing,
    placementChanged: !!draft.placementChanged,
  });
}

function applyDeadlineGhostTitle(preview, title) {
  if (!preview?.ghosts?.length) return preview;
  const nextTitle = String(title || "").trim() || "Untitled";
  let changed = false;
  const ghosts = preview.ghosts.map((ghost) => {
    if (ghost.title === nextTitle) return ghost;
    changed = true;
    return { ...ghost, title: nextTitle };
  });
  return changed ? { ...preview, ghosts } : preview;
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
  setViewDate,
  setFetchAnchor,
  setLabelMonth,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  manualMonthBrowseKey = 0,
}) {
  const autoNavRef = useRef({ lastNavigateAt: 0, lastTargetDate: "" });
  const suppressedAutoNavRef = useRef({ browseKey: manualMonthBrowseKey, ghostSignature: "" });
  const eventGhostInputSignature = eventEditorGhostInputSignature(eventEditor);
  const eventGhostInput = useMemo(() => (
    eventGhostInputSignature ? JSON.parse(eventGhostInputSignature) : null
  ), [eventGhostInputSignature]);
  const eventGhostPreviewBase = useMemo(() => (
    view === "events"
      ? buildEventGhostPreview({ editor: eventGhostInput, events: viewData?.events || [] })
      : null
  ), [eventGhostInput, view, viewData?.events]);
  const eventGhostTitleList = eventEditorGhostTitles(eventEditor);
  const eventGhostTitleSignature = JSON.stringify(eventGhostTitleList);
  const eventGhostPreview = useMemo(() => (
    applyEventGhostTitles(eventGhostPreviewBase, JSON.parse(eventGhostTitleSignature))
  ), [eventGhostPreviewBase, eventGhostTitleSignature]);
  const deadlineGhostInputSignatureValue = deadlineGhostInputSignature(deadlineDraftPreview);
  const deadlineGhostInput = useMemo(() => (
    deadlineGhostInputSignatureValue ? JSON.parse(deadlineGhostInputSignatureValue) : null
  ), [deadlineGhostInputSignatureValue]);
  const deadlineDateItems = deadlineGhostInput?.dueDate
    ? computed.itemsByDate?.[deadlineGhostInput.dueDate]
    : null;
  const deadlineGhostPreview = useMemo(() => {
    if (view !== "events" || !deadlineEditor?.mode || !deadlineGhostInput) return null;
    return buildDeadlineGhostPreview({ draft: deadlineGhostInput, dateItems: deadlineDateItems });
  }, [deadlineDateItems, deadlineEditor?.mode, deadlineGhostInput, view]);
  const deadlineGhostTitle = deadlineDraftPreview?.title || "";
  const deadlineGhostPreviewWithTitle = useMemo(() => (
    applyDeadlineGhostTitle(deadlineGhostPreview, deadlineGhostTitle)
  ), [deadlineGhostPreview, deadlineGhostTitle]);
  const ghostPreview = view === "events"
    ? combineGhostPreviews(eventGhostPreview, deadlineGhostPreviewWithTitle)
    : deadlineGhostPreviewWithTitle;
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
      setViewDate({ year: parsed.year, month: parsed.month });
      setFetchAnchor({ year: parsed.year, month: parsed.month });
      setLabelMonth({ year: parsed.year, month: parsed.month });
      setSelectedDay(parsed.day);
      setSelectedDateKey(target);
      setSelectedItemId(null);
      last.lastNavigateAt = nowMs;
      last.lastTargetDate = target;
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [ghostPreview?.targetDate, ghostSignature, open, setFetchAnchor, setLabelMonth, setSelectedDateKey, setSelectedDay, setSelectedItemId, setViewDate, viewMonth, viewYear]);

  return ghostPreview;
}
