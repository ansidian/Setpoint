import { useEffect } from "react";
import { ymdFromParts } from "../../components/calendar/calendarDateUtils.js";
import { ymdFromView } from "./calendarModalSelectionModel.js";
import {
  isFloatingDetailFlipSuppressedTarget,
  isGridOriginFloatingDetail,
} from "./calendarFloatingDetailModel.js";

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function isSuspendedHotkeyTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-suspend-calendar-hotkeys='true']");
}

export default function useCalendarModalHotkeys({
  open,
  canGoPrev,
  currentMonth,
  currentYear,
  todayDate,
  view,
  viewYear,
  viewMonth,
  closeCalendarModal,
  closeEventEditor,
  eventEditor,
  deadlineEditor,
  setDeadlineEditor,
  setDeadlineDraftPreview,
  selectedItemId,
  selectedDay,
  selectedDateKey,
  activeView,
  itemsByDay,
  itemsByDate,
  setSuppressFocusRing,
  floatingDetail,
  floatingDetailRef,
  setFloatingDetail,
  handleViewChange,
  usesFloatingEditor,
  cancelFloatingEditor,
  flipFloatingDetailSide,
  shakeFloatingEditor,
  setViewDate,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  requestAgendaScroll,
  openFloatingEventEdit,
  openFloatingDeadlineEdit,
  openFloatingEventCreate,
  openFloatingDeadlineCreate,
  navigateMonthRef,
}) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKey(event) {
      if (event.key === "Tab") {
        setSuppressFocusRing(false);
        return;
      }

      const consumeCalendarKey = ({ preventDefault = true } = {}) => {
        setSuppressFocusRing(true);
        if (preventDefault && event.cancelable) event.preventDefault();
        event.stopPropagation();
      };

      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        consumeCalendarKey();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape" && floatingDetail?.open) {
        if (floatingDetail.mode === "edit" || floatingDetail.mode === "create") {
          cancelFloatingEditor();
        } else {
          setFloatingDetail(null);
        }
        consumeCalendarKey();
        return;
      }

      if (event.key === "Escape" && view === "deadlines" && deadlineEditor?.mode) {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
        consumeCalendarKey();
        return;
      }

      if (isSuspendedHotkeyTarget(event.target)) return;

      if (isEditableTarget(event.target)) {
        if (event.key === "Escape") {
          closeCalendarModal();
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === " ") {
        const currentDetail = floatingDetailRef.current;
        if (isGridOriginFloatingDetail(currentDetail)
          && !currentDetail.dirty
          && !isFloatingDetailFlipSuppressedTarget(event.target, currentDetail)
        ) {
          flipFloatingDetailSide();
          consumeCalendarKey();
          return;
        }
      }

      if (
        (event.key === "Enter" || event.key === " ")
        && event.target instanceof HTMLElement
        && event.target.closest("button, [role='button'], [role='gridcell']")
      ) {
        setSuppressFocusRing(true);
        return;
      }

      switch (event.key) {
        case "Escape":
          closeCalendarModal();
          consumeCalendarKey({ preventDefault: false });
          break;
        case "ArrowLeft":
        case "p":
          if (canGoPrev) navigateMonthRef.current?.(-1);
          consumeCalendarKey();
          break;
        case "ArrowRight":
        case "n":
          navigateMonthRef.current?.(1);
          consumeCalendarKey();
          break;
        case "t":
        case "T":
          if (floatingDetailRef.current?.open
            && (floatingDetailRef.current.mode === "edit" || floatingDetailRef.current.mode === "create")
            && floatingDetailRef.current.dirty
          ) {
            shakeFloatingEditor();
            consumeCalendarKey();
            break;
          }
          if (eventEditor.isEditorOpen && eventEditor.isDirty) {
            shakeFloatingEditor();
            consumeCalendarKey();
            break;
          }
          closeEventEditor();
          setFloatingDetail(null);
          setDeadlineEditor(null);
          setDeadlineDraftPreview(null);
          setViewDate({ month: currentMonth, year: currentYear });
          setSelectedDay(todayDate);
          setSelectedDateKey(ymdFromParts(currentYear, currentMonth, todayDate));
          setSelectedItemId(null);
          requestAgendaScroll({ type: "today" });
          consumeCalendarKey();
          break;
        case "e":
        case "E":
          if (selectedItemId != null) {
            if (view === "events" && eventEditor.editable) {
              const dayItems = itemsByDate?.[selectedDateKey] || itemsByDay[selectedDay] || [];
              const resolveId = activeView.getItemId;
              const ev = dayItems.find((item) => String(resolveId(item)) === String(selectedItemId));
              if (ev) {
                if (usesFloatingEditor) {
                  openFloatingEventEdit(ev, { dateKey: selectedDateKey });
                } else {
                  setFloatingDetail(null);
                  eventEditor.openEdit(ev);
                }
              }
            } else if (view === "deadlines") {
              const dayState = itemsByDate?.[selectedDateKey] || itemsByDay[selectedDay];
              const pool = dayState?.items || dayState || [];
              const task = (Array.isArray(pool) ? pool : []).find((t) => String(t?.id) === String(selectedItemId));
              if (task?.source === "todoist") {
                if (usesFloatingEditor) {
                  openFloatingDeadlineEdit(task, { dateKey: selectedDateKey });
                } else {
                  setFloatingDetail(null);
                  setDeadlineEditor({ mode: "edit", taskId: String(selectedItemId) });
                  setDeadlineDraftPreview(null);
                }
              }
            }
          }
          consumeCalendarKey();
          break;
        case "c":
        case "C":
          if (view === "events" && eventEditor.editable) {
            if (usesFloatingEditor) {
              openFloatingEventCreate(selectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay }));
            } else {
              setFloatingDetail(null);
              eventEditor.openCreate();
            }
          } else if (view === "deadlines") {
            if (usesFloatingEditor) {
              openFloatingDeadlineCreate(selectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay }));
            } else {
              setFloatingDetail(null);
              setDeadlineEditor({
                mode: "create",
                seedDate: selectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay }),
              });
              setDeadlineDraftPreview(null);
            }
          }
          consumeCalendarKey();
          break;
        case "1":
          if (view !== "events") handleViewChange("events");
          consumeCalendarKey();
          break;
        case "2":
          if (view !== "bills") handleViewChange("bills");
          consumeCalendarKey();
          break;
        case "3":
          if (view !== "deadlines") handleViewChange("deadlines");
          consumeCalendarKey();
          break;
        default:
          if (event.key === "Enter" || (event.key.length === 1 && event.key !== " " && event.key !== "r" && event.key !== "R")) {
            consumeCalendarKey();
          }
          break;
      }
    }

    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
    // The editor routing helpers intentionally read the latest modal refs inside this document listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canGoPrev, currentMonth, currentYear, todayDate, view, viewYear, viewMonth, closeCalendarModal, closeEventEditor, eventEditor, deadlineEditor, selectedItemId, selectedDay, selectedDateKey, activeView, itemsByDay, itemsByDate, setDeadlineEditor, floatingDetail?.open, floatingDetail?.mode, handleViewChange, usesFloatingEditor]);
}
