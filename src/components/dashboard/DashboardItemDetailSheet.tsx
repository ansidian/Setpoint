import { useRef, useState } from "react";
import { CalendarDays, Check, CreditCard, ExternalLink, Pencil, Video } from "lucide-react";
import AnchoredFloatingPanel from "../shared/pickers/AnchoredFloatingPanel";
import { RailAction, RailActionGroup } from "../calendar/DetailRailPrimitives";
import DeadlineDetailCard from "../calendar/views/deadlines/DeadlineDetailCard";
import EventSelectedCard from "../calendar/views/events/EventSelectedCard";
import BillSelectedCard from "../calendar/views/bills/BillSelectedCard";
import { eventAccent } from "../calendar/views/events/eventDetailModel";
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
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const editAnchorRef = useRef<HTMLDivElement | null>(null);
  const { handleCompleteTask, handleUpdateTask } = useDashboard();

  if (!item) return null;
  const placementKey = `${kind}:${String(item.id || item.uid || item.title || "item")}`;

  function doComplete() {
    setCompleting(true);
    const deadline = item as DashboardDeadline;
    Promise.resolve(handleCompleteTask(String(deadline.id), deadline)).catch(() => setCompleting(false));
    window.setTimeout(() => onClose(), 720);
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
        const Icon = ACTION_ICON[action.key];
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
            tone={action.tone}
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
    card = <BillSelectedCard bill={item} actions={actionRow} />;
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
        hideTitle
        width={360}
        maxWidth={380}
        animatePosition
        draggable
        dragHandleLabel={KIND_LABEL[kind]}
        placementKey={placementKey}
        // Blend into the dashboard instead of reading as a bolted-on modal: wear
        // the dashboard's own elevated-surface color (--sp-surface #24243a),
        // slightly translucent so it reads as the canvas lifting up, in place of
        // the near-black floating-panel slab (--sp-panel #16161e); and a soft,
        // accent-tinted elevation in place of the heavy 0 20px 60px rgba(0,0,0,.7)
        // drop shadow. No backdrop-blur on purpose — PRODUCT.md lists
        // glassmorphism as an anti-reference and the shell avoids live
        // backdrop-filter for perf, so translucency alone carries the frost.
        // Border stays off: the reused hero card supplies the only edge, so a
        // panel border would read as a doubled card-in-a-card.
        style={{
          padding: 0,
          borderRadius: 16,
          border: "none",
          background: "color-mix(in srgb, var(--sp-surface) 88%, transparent)",
          boxShadow: `0 18px 44px -22px rgba(0,0,0,0.55), 0 4px 16px -8px color-mix(in srgb, ${accent} 22%, transparent)`,
        }}
      >
        <div ref={editAnchorRef} style={{ padding: 8 }}>{card}</div>
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
