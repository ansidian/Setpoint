import { useEffect } from "react";
import { ymdFromParts } from "../../components/calendar/calendarDateUtils.js";
import { ymdFromView } from "./calendarModalSelectionModel.js";
import {
  isFloatingDetailPanelTarget,
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

// "all" fully detaches a container from calendar hotkeys — for overlays that
// stack ABOVE the modal (the Alfred panel and its email preview). Unlike
// "true" (checked mid-handler so detail/search Escape branches still apply),
// this is checked before ANY branch runs.
function isFullySuspendedHotkeyTarget(target) {
  return target instanceof HTMLElement
    && !!target.closest("[data-suspend-calendar-hotkeys='all']");
}

function visibleOverflowPopoverOwnsEscape() {
  return typeof document !== "undefined"
    && !!document.querySelector("[data-testid='calendar-cell-overflow-popover']")
    && !document.querySelector("[data-testid='calendar-floating-detail-panel']");
}

function closeVisibleOverflowPopover() {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent("calendar-overflow-close"));
}

function isDeadlineItem(item) {
  const isDeadline = item?.calendarItemKind === "deadline" || (!!item?.due_date && !item?.startMs);
  return isDeadline && !!item?.id;
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
  setFetchAnchor,
  setLabelMonth,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  requestAgendaScroll,
  resolveSelectedAgendaEditAnchor,
  openFloatingEventEdit,
  openFloatingDeadlineEdit,
  openFloatingEventCreate,
  openFloatingDeadlineCreate,
  toggleEventOverlay,
  deadlineOverlayVisible = false,
  toggleDeadlineOverlay,
  toggleCompletedDeadlineOverlay,
  setDeadlineOverlayVisible,
  navigateMonthRef,
  onCopySelectedEvent,
  onPasteCopiedEvent,
  onDeleteSelectedEvents,
  onBeginEventSelectionSetFromSelected,
  openCalendarSearch,
  cancelCalendarSearch,
}) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKey(event) {
      if (isFullySuspendedHotkeyTarget(event.target)) return;
      if (event.key === "Tab") {
        setSuppressFocusRing(false);
        return;
      }

      const consumeCalendarKey = ({ preventDefault = true } = {}) => {
        setSuppressFocusRing(true);
        if (preventDefault && event.cancelable) event.preventDefault();
        event.stopPropagation();
      };

      const commandKey = event.metaKey || event.ctrlKey;
      const normalizedKey = String(event.key || "").toLowerCase();

      if (
        floatingDetail?.open
        && floatingDetail.mode === "detail"
        && (normalizedKey === "meta" || normalizedKey === "control")
      ) {
        if (!onBeginEventSelectionSetFromSelected?.()) {
          setFloatingDetail(null);
        }
        consumeCalendarKey();
        return;
      }

      if (commandKey && normalizedKey === "f") {
        openCalendarSearch?.();
        consumeCalendarKey();
        return;
      }

      if (commandKey && !event.altKey && !event.shiftKey && normalizedKey === "1") {
        if (view !== "events") handleViewChange("events");
        consumeCalendarKey();
        return;
      }

      if (commandKey && !event.altKey && !event.shiftKey && normalizedKey === "2") {
        if (view !== "bills") handleViewChange("bills");
        consumeCalendarKey();
        return;
      }

      if (event.key === "Escape" && document.querySelector("[data-calendar-month-picker]")) {
        return;
      }

      if (event.key === "Escape" && visibleOverflowPopoverOwnsEscape()) {
        closeVisibleOverflowPopover();
        consumeCalendarKey({ preventDefault: false });
        return;
      }

      if (event.key === "Escape" && floatingDetail?.open) {
        if (floatingDetail.mode === "edit" || floatingDetail.mode === "create") {
          cancelFloatingEditor();
        } else {
          setFloatingDetail(null);
        }
        consumeCalendarKey();
        return;
      }

      if (event.key === "Escape" && view === "events" && deadlineEditor?.mode) {
        setDeadlineEditor(null);
        setDeadlineDraftPreview(null);
        consumeCalendarKey();
        return;
      }

      if (event.key === "Escape" && cancelCalendarSearch?.()) {
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

      if (commandKey && !event.altKey && !event.shiftKey && normalizedKey === "c") {
        onCopySelectedEvent?.();
        consumeCalendarKey();
        return;
      }

      if (commandKey && !event.altKey && !event.shiftKey && normalizedKey === "v") {
        onPasteCopiedEvent?.();
        consumeCalendarKey();
        return;
      }

      if (event.key === " ") {
        const currentDetail = floatingDetailRef.current;
        if (!commandKey
          && !event.altKey
          && !event.shiftKey
          && isGridOriginFloatingDetail(currentDetail)
          && !currentDetail.dirty
          && !isFloatingDetailPanelTarget(event.target)
        ) {
          flipFloatingDetailSide?.();
          consumeCalendarKey();
          return;
        }
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if ((event.key === "Delete" || event.key === "Backspace") && view === "events") {
        if (onDeleteSelectedEvents?.()) {
          consumeCalendarKey();
          return;
        }
      }

      if (
        event.key === "Enter"
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
          setFetchAnchor({ month: currentMonth, year: currentYear });
          setLabelMonth({ month: currentMonth, year: currentYear });
          setSelectedDay(todayDate);
          setSelectedDateKey(ymdFromParts(currentYear, currentMonth, todayDate));
          setSelectedItemId(null);
          requestAgendaScroll({ type: "today" });
          if (viewYear === currentYear && viewMonth === currentMonth) {
            document.dispatchEvent(new CustomEvent("calendar-grid-scroll-reset"));
          }
          consumeCalendarKey();
          break;
        case "e":
        case "E":
          if (event.shiftKey && view === "events") {
            toggleEventOverlay?.();
            consumeCalendarKey();
            break;
          }
          if (selectedItemId != null) {
            if (view === "events") {
              const dayItems = itemsByDate?.[selectedDateKey] || itemsByDay[selectedDay] || [];
              const resolveId = activeView.getItemId;
              const selectedItem = dayItems.find((item) => String(resolveId(item)) === String(selectedItemId));
              if (isDeadlineItem(selectedItem)) {
                if (usesFloatingEditor) {
                  openFloatingDeadlineEdit(selectedItem, {
                    dateKey: selectedDateKey,
                    ...resolveSelectedAgendaEditAnchor?.(selectedItemId, selectedDateKey),
                  });
                } else {
                  setFloatingDetail(null);
                  setDeadlineEditor({ mode: "edit", taskId: String(selectedItem.id) });
                  setDeadlineDraftPreview(null);
                }
              } else if (selectedItem && eventEditor.editable) {
                if (usesFloatingEditor) {
                  openFloatingEventEdit(selectedItem, {
                    dateKey: selectedDateKey,
                    ...resolveSelectedAgendaEditAnchor?.(selectedItemId, selectedDateKey),
                  });
                } else {
                  setFloatingDetail(null);
                  eventEditor.openEdit(selectedItem);
                }
              }
            }
          }
          consumeCalendarKey();
          break;
        case "c":
        case "C":
          if (event.shiftKey && view === "events") {
            setDeadlineOverlayVisible?.(true);
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
          } else if (view === "events" && eventEditor.editable) {
            if (usesFloatingEditor) {
              openFloatingEventCreate(selectedDateKey || ymdFromView({ viewYear, viewMonth, selectedDay }));
            } else {
              setFloatingDetail(null);
              eventEditor.openCreate();
            }
          }
          consumeCalendarKey();
          break;
        case "d":
        case "D":
          if (view === "events") {
            if (event.shiftKey) {
              toggleDeadlineOverlay?.();
            } else {
              if (deadlineOverlayVisible) toggleCompletedDeadlineOverlay?.();
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
  }, [open, canGoPrev, currentMonth, currentYear, todayDate, view, viewYear, viewMonth, closeCalendarModal, closeEventEditor, eventEditor, deadlineEditor, selectedItemId, selectedDay, selectedDateKey, activeView, itemsByDay, itemsByDate, setDeadlineEditor, floatingDetail?.open, floatingDetail?.mode, handleViewChange, usesFloatingEditor, onCopySelectedEvent, onPasteCopiedEvent, onDeleteSelectedEvents, onBeginEventSelectionSetFromSelected, openCalendarSearch, cancelCalendarSearch]);
}
