import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarDays, Check, CircleCheck, CreditCard, ExternalLink, Pencil, ReceiptText, Video } from "lucide-react";
import AnchoredFloatingPanel from "../shared/pickers/AnchoredFloatingPanel";
import { RailAction, RailActionGroup } from "../calendar/DetailRailPrimitives";
import DeadlineDetailCard from "../calendar/views/deadlines/DeadlineDetailCard";
import EventSelectedCard from "../calendar/views/events/EventSelectedCard";
import RecurringPaymentCard from "../finances/RecurringPaymentCard";
import { eventAccent } from "../calendar/views/events/eventDetailModel";
import { deadlineAccentFor } from "../calendar/views/deadlines/deadlinesModel";
import { useDashboard } from "../../context/DashboardContext";
import AddTaskPanel from "../todoist/AddTaskPanel";
import { selectGlanceActions } from "./glanceActionsModel";
import type { RefObject } from "react";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";
import type { GlanceActionContext, GlanceActionKey, GlanceKind } from "./glanceActionsModel";
import type { TodoistEditorTask } from "../todoist/add-task-panel/types";

export type DashboardSheetItem = DashboardDeadline | (Record<string, unknown> & { id?: string });
interface DashboardItemDetailSheetProps {
  kind: GlanceKind;
  item: DashboardSheetItem | null;
  anchorRef?: RefObject<HTMLElement | null>;
  accent?: string;
  ctx?: GlanceActionContext;
  onClose: () => void;
  onOpenInCalendar?: () => void;
}

// Unified in-place "glance" sheet for a dashboard item tap. Shows the full item
// detail (reusing the calendar's domain cards) plus the cheap per-type action and
// an explicit "Open in calendar" deep-link — instead of jumping straight to the
// calendar + floating detail. Anchored panel on desktop, bottom sheet on mobile
// (via AnchoredFloatingPanel). Replaces DeadlineDetailPopover + CalendarItemDetailSheet.

const KIND_LABEL = { deadline: "Deadline", bill: "Bill", event: "Event" };
const KIND_ICON = { deadline: CircleCheck, bill: ReceiptText, event: CalendarDays };

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
}: DashboardItemDetailSheetProps) {
  const placementKey = `${kind}:${String(item?.id || item?.uid || item?.title || "item")}`;
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [selectionKey, setSelectionKey] = useState(placementKey);
  const completionTimer = useRef<number | undefined>(undefined);
  const editAnchorRef = useRef<HTMLDivElement | null>(null);
  const { handleCompleteTask, handleUpdateTask } = useDashboard();

  // Keep the moving shell, but reset the previous item's interaction state.
  if (selectionKey !== placementKey) {
    setSelectionKey(placementKey);
    setEditing(false);
    setCompleting(false);
  }
  useLayoutEffect(() => () => {
    window.clearTimeout(completionTimer.current);
    completionTimer.current = undefined;
  }, [placementKey]);

  if (!item) return null;
  const KindIcon = KIND_ICON[kind];
  const detailAccent = kind === "bill" ? "var(--sp-outflow)" : kind === "deadline" ? deadlineAccentFor(item) : eventAccent(item);

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
    edit: () => setEditing(true),
    openInCalendar: () => onOpenInCalendar?.(),
  };

  const actions = selectGlanceActions({
    kind,
    item: item as Parameters<typeof selectGlanceActions>[0]["item"],
    ctx,
  });

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
  if (kind === "deadline") {
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
      <AnchoredFloatingPanel
        anchorRef={anchorRef || editAnchorRef}
        onClose={onClose}
        ariaLabel={KIND_LABEL[kind] || "Details"}
        open={!editing}
        width={360}
        maxWidth={380}
        animatePosition
        dismissIgnoreSelector="[data-dashboard-detail-trigger='true']"
        draggable
        dragHandleLabel={<span className="detail-panel-label" style={{ color: `color-mix(in srgb, ${detailAccent} 75%, #cdd6f4)` }}><KindIcon size={14} aria-hidden="true" />{KIND_LABEL[kind]}</span>}
        placementKey={placementKey}
        style={{
          padding: 0,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,.09)",
          background: "#16161e",
          boxShadow: "0 13px 26px -12px rgba(0,0,0,.6)",
        }}
      >
        <div key={placementKey} ref={editAnchorRef} style={{ padding: "0 8px 8px" }}>{card}</div>
      </AnchoredFloatingPanel>

      {editing && (
        <AddTaskPanel
          anchorRef={editAnchorRef}
          editingTask={item as TodoistEditorTask}
          onClose={() => setEditing(false)}
          onTaskUpdated={(updated) => { handleUpdateTask(updated as DashboardDeadline); setEditing(false); onClose(); }}
        />
      )}
    </>
  );
}
