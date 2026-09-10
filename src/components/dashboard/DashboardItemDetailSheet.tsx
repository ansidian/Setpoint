import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarDays, Check, CircleCheck, CreditCard, ExternalLink, Mail, Pencil, ReceiptText, Video } from "lucide-react";
import AnchoredFloatingPanel from "../shared/pickers/AnchoredFloatingPanel";
import { RailAction, RailActionGroup } from "../calendar/DetailRailPrimitives";
import DeadlineDetailCard from "../calendar/views/deadlines/DeadlineDetailCard";
import EventSelectedCard from "../calendar/views/events/EventSelectedCard";
import RecurringPaymentCard from "../finances/RecurringPaymentCard";
import { eventAccent } from "../calendar/views/events/eventDetailModel";
import { deadlineAccentFor } from "../calendar/views/deadlines/deadlinesModel";
import { useDashboard } from "../../context/DashboardContext";
import EmailDetailCard from "./EmailDetailCard";
import type { NeedsYouEmail } from "./needsYou/needsYouModel";
import AddTaskPanel from "../todoist/AddTaskPanel";
import CalendarEventEditorRail from "../calendar/events/CalendarEventEditorRail";
import useCalendarEventEditor from "../calendar/events/useCalendarEventEditor";
import type { CalendarRangeController } from "../../hooks/calendar/useCalendarRange";
import useIsMobile from "../../hooks/useIsMobile";
import { selectGlanceActions } from "./glanceActionsModel";
import type { RefObject } from "react";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";
import type { GlanceActionContext, GlanceActionKey, GlanceKind } from "./glanceActionsModel";
import type { TodoistEditorTask } from "../todoist/add-task-panel/types";

export type DashboardSheetItem = DashboardDeadline | (Record<string, unknown> & { id?: string });
interface DashboardItemDetailSheetProps {
  kind: GlanceKind | "email";
  item: DashboardSheetItem | null;
  anchorRef?: RefObject<HTMLElement | null>;
  accent?: string;
  ctx?: GlanceActionContext;
  onClose: () => void;
  onOpenInCalendar?: () => void;
  onOpenEmail?: (uid: string | number) => void;
  calendarRange: Partial<CalendarRangeController>;
  onEditorDirtyChange?: (dirty: boolean) => void;
}

// Unified in-place "glance" sheet for a dashboard item tap. Shows the full item
// detail and Calendar's event/deadline workspaces in a single anchored panel
// on desktop or bottom sheet on mobile. Cancel/save restore this detail view.

const KIND_LABEL = { deadline: "Deadline", bill: "Bill", event: "Event", email: "Email" };
const KIND_ICON = { deadline: CircleCheck, bill: ReceiptText, event: CalendarDays, email: Mail };

const ACTION_ICON = {
  complete: Check,
  edit: Pencil,
  todoist: ExternalLink,
  actual: ExternalLink,
  pay: CreditCard,
  zoom: Video,
  eventUrl: ExternalLink,
  gcal: ExternalLink,
  openInCalendar: CalendarDays,
};

export default function DashboardItemDetailSheet({
  kind,
  item,
  anchorRef,
  accent = "#cba6da",
  ctx,
  onClose,
  onOpenInCalendar,
  onOpenEmail,
  calendarRange,
  onEditorDirtyChange,
}: DashboardItemDetailSheetProps) {
  const placementKey = `${kind}:${String(item?.id || item?.uid || item?.title || "item")}`;
  const [editingTask, setEditingTask] = useState<TodoistEditorTask | null>(null);
  const [completing, setCompleting] = useState(false);
  const [savedItem, setSavedItem] = useState<DashboardSheetItem | null>(null);
  const [deadlineDirty, setDeadlineDirty] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [selectionKey, setSelectionKey] = useState(placementKey);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const completionTimer = useRef<number | undefined>(undefined);
  const fallbackAnchorRef = useRef<HTMLSpanElement | null>(null);
  const panelAnchorRef = useRef<HTMLElement | null>(null);
  const isMobile = useIsMobile();
  useLayoutEffect(() => {
    // Responsive dashboard rows can replace the original trigger. Keep the
    // workspace visible at a neutral anchor while its draft is still active.
    panelAnchorRef.current = anchorRef?.current?.isConnected ? anchorRef.current : fallbackAnchorRef.current;
  }, [anchorRef, isMobile]);
  const { handleCompleteTask, handleUpdateTask, handleDeleteTask } = useDashboard();
  const eventEditor = useCalendarEventEditor({
    open: kind === "event" && !!item,
    view: "events",
    // The containing mobile sheet owns Back; a second history token would
    // discard the event form when that sheet unmounts at a desktop breakpoint.
    manageHistory: false,
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    refreshRange: calendarRange.refreshRangeInPlace,
    upsertEvents: calendarRange.upsertEvents,
    removeEvent: calendarRange.removeEvent,
    onSaved: (event) => {
      if (event) setSavedItem(event as unknown as DashboardSheetItem);
      setCloseBlocked(false);
    },
    onDeleted: onClose,
  });
  const editorOpen = !!editingTask || eventEditor.isEditorOpen;
  const dirty = eventEditor.isEditorOpen ? eventEditor.isDirty : !!editingTask && deadlineDirty;
  useLayoutEffect(() => {
    onEditorDirtyChange?.(!!dirty);
    return () => onEditorDirtyChange?.(false);
  }, [dirty, onEditorDirtyChange]);
  useEffect(() => {
    if (!editorOpen) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty, editorOpen]);

  // Keep the moving shell, but reset the previous item's interaction state.
  if (selectionKey !== placementKey) {
    setSelectionKey(placementKey);
    setEditingTask(null);
    setCompleting(false);
    setSavedItem(null);
    setDeadlineDirty(false);
    setCloseBlocked(false);
    eventEditor.closeEditor();
  }
  useLayoutEffect(() => () => {
    window.clearTimeout(completionTimer.current);
    completionTimer.current = undefined;
  }, [placementKey]);

  item = savedItem || item;
  const actions = !item || kind === "email" ? [] : selectGlanceActions({
    kind,
    item: item as Parameters<typeof selectGlanceActions>[0]["item"],
    ctx,
  });
  const canEdit = actions.some((action) => action.key === "edit");
  const openEdit = useCallback(() => {
    if (!item || !canEdit || editorOpen || completing) return;
    if (kind === "event") void eventEditor.openEdit(item as Parameters<typeof eventEditor.openEdit>[0]);
    else setEditingTask(item as TodoistEditorTask);
  }, [item, canEdit, editorOpen, completing, kind, eventEditor]);

  useEffect(() => {
    if (!canEdit || editorOpen || completing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing
        || event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "e") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable || target?.closest(
        "input, textarea, select, [contenteditable='true'], [data-suspend-calendar-hotkeys], [data-suspend-inbox-hotkeys]",
      )) return;
      const panel = contentRef.current?.closest('[role="dialog"]');
      if (!panel || document.querySelector("[data-workspace-foreground], [data-suspend-calendar-hotkeys='blocking']")) return;
      // A menu or another dialog owns the keyboard even if focus stayed on body.
      if (Array.from(document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]'))
        .some((overlay) => overlay !== panel && overlay.getClientRects().length > 0)) return;
      event.preventDefault();
      openEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, editorOpen, completing, openEdit]);

  if (!item) return null;
  const returnToDetail = () => {
    eventEditor.closeEditor();
    setEditingTask(null);
    setDeadlineDirty(false);
    setCloseBlocked(false);
  };
  const dismiss = () => {
    if (eventEditor.saving || eventEditor.deleting) return false;
    if (dirty) {
      setCloseBlocked(true);
      return false;
    }
    if (editorOpen) {
      returnToDetail();
      return false;
    }
    onClose();
    return true;
  };
  const KindIcon = KIND_ICON[kind];
  const detailAccent = kind === "email" ? "var(--sp-rose)" : kind === "bill" ? "var(--sp-outflow)" : kind === "deadline" ? deadlineAccentFor(item) : eventAccent(item);

  function doComplete() {
    setCompleting(true);
    const deadline = item as DashboardDeadline;
    const timer = window.setTimeout(() => { completionTimer.current = undefined; onClose(); }, 720);
    completionTimer.current = timer;
    Promise.resolve(handleCompleteTask(String(deadline.id), deadline)).catch(() => {
      if (completionTimer.current === timer) setCompleting(false);
    });
  }

  const commandHandlers: Partial<Record<GlanceActionKey, () => void>> = {
    complete: doComplete,
    edit: openEdit,
    openInCalendar: () => onOpenInCalendar?.(),
  };

  const actionRow = actions.length ? (
    <RailActionGroup>
      {actions.map((action) => {
        const Icon = kind === "bill" && action.key === "openInCalendar" ? ArrowUpRight : ACTION_ICON[action.key];
        if (action.type === "link") {
          return (
            <RailAction
              key={action.key}
              icon={Icon}
              label={action.label}
              href={action.href}
              tone={action.tone}
              size="compact"
              accent={accent}
              onClick={onClose}
            />
          );
        }
        const isComplete = action.key === "complete";
        return (
          <RailAction
            key={action.key}
            icon={Icon}
            label={isComplete && completing ? "Completing…" : action.label}
            onClick={commandHandlers[action.key]}
            href={undefined}
            tone={kind === "bill" && action.key === "openInCalendar" ? "default" : action.tone}
            size="compact"
            accent={accent}
            disabled={isComplete && completing}
            loading={isComplete && completing}
          />
        );
      })}
    </RailActionGroup>
  ) : null;

  let card = null;
  if (kind === "email") {
    card = <EmailDetailCard email={item as NeedsYouEmail} onOpen={() => {
      const uid = item.uid ?? item.email_id ?? item.id;
      if (typeof uid !== "string" && typeof uid !== "number") return;
      onClose();
      onOpenEmail?.(uid);
    }} />;
  } else if (kind === "deadline") {
    card = (
      <DeadlineDetailCard
        task={{ ...item, _completing: completing }}
        accent={accent}
        compact
        actions={actionRow}
      />
    );
  } else if (kind === "bill") {
    card = <RecurringPaymentCard bill={item} actions={actionRow} />;
  } else {
    card = <EventSelectedCard ev={item} accent={eventAccent(item)} actions={actionRow} />;
  }

  return (
    <>
      <span ref={fallbackAnchorRef} aria-hidden="true" style={{ position: "fixed", left: "max(12px, calc(50vw - 220px))", top: "10vh", width: 1, height: 1, pointerEvents: "none" }} />
      <AnchoredFloatingPanel
        anchorRef={panelAnchorRef}
        onClose={dismiss}
        ariaLabel={KIND_LABEL[kind] || "Details"}
        width={editorOpen ? 440 : 360}
        maxWidth={editorOpen ? 440 : 380}
        mobileHeight={editorOpen ? "90dvh" : undefined}
        animateSize
        animatePosition
        dismissIgnoreSelector="[data-dashboard-detail-trigger='true']"
        draggable
        avoidAnchorRegion="[data-dashboard-detail-region]"
        dragHandleLabel={<span className="detail-panel-label" style={{ color: `color-mix(in srgb, ${detailAccent} 75%, #cdd6f4)` }}><KindIcon size={14} aria-hidden="true" />{KIND_LABEL[kind]}</span>}
        placementKey={`${placementKey}:${editorOpen ? "editor" : "detail"}`}
        style={{
          padding: 0,
          maxHeight: "calc(100dvh - 20px)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,.09)",
          background: "#16161e",
          boxShadow: "0 13px 26px -12px rgba(0,0,0,.6)",
        }}
      >
        <div ref={contentRef} key={placementKey} style={{ padding: editorOpen ? "0 20px 20px" : "0 8px 8px" }}>
          {closeBlocked && editorOpen && <p role="status" style={{ color: "var(--sp-cream)", fontSize: 12 }}>Save or cancel your changes before closing.</p>}
          {eventEditor.isEditorOpen ? (
            <CalendarEventEditorRail editor={{ ...eventEditor, closeEditor: returnToDetail }} host="floating" />
          ) : editingTask ? (
            <AddTaskPanel
              host="inline"
              editingTask={editingTask}
              onDirtyChange={setDeadlineDirty}
              onClose={returnToDetail}
              onTaskUpdated={(updated) => {
                handleUpdateTask(updated as DashboardDeadline);
                setSavedItem(updated as DashboardDeadline);
              }}
              onTaskDeleted={(taskId) => { handleDeleteTask(taskId); onClose(); }}
            />
          ) : card}
        </div>
      </AnchoredFloatingPanel>
    </>
  );
}
