import { lazy, Suspense } from "react";
import { AnalyticsModalMount } from "../shell/AnalyticsModalMount";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";
import type { ActiveSnapshotView } from "../../../shared/types/snapshots";
import type { DashboardActiveSnapshotController } from "./useLiveReadOverrides";
import type { DashboardGlanceSheet } from "./dashboardShellModel";
import type { GlanceActionContext } from "./glanceActionsModel";
import type { DashboardSheetItem } from "./DashboardItemDetailSheet";

interface DashboardShellOverlaysProps {
  isMobile: boolean;
  itemSheet: DashboardGlanceSheet | null;
  closeItemSheet: () => void;
  onOpenItemInCalendar: (sheet: DashboardGlanceSheet) => void;
  billCtx: GlanceActionContext;
  accent: string;
  addTaskOpen: boolean;
  setAddTaskOpen: Dispatch<SetStateAction<boolean>>;
  handleAddTask: (task: DashboardDeadline) => void;
  queueCalendarDeadlineRefresh: () => void;
  paletteOpen: boolean;
  closePalette: () => void;
  handlePaletteAction: (action: { kind: string; payload?: string }) => void;
  analyticsOpen: boolean;
  closeAnalytics: () => void;
  historyOpen: boolean;
  historicalSnapshotView: ActiveSnapshotView | null;
  activeSnapshot: DashboardActiveSnapshotController;
  historyTriggerRef: RefObject<HTMLElement | null>;
  handleSelectSnapshot: (snapshot: ActiveSnapshotView, meta?: { readOnly?: boolean }) => void;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
}

const AddTaskPanel = lazy(() => import("../todoist/AddTaskPanel"));
const BriefingHistoryPanel = lazy(() => import("../briefing/BriefingHistoryPanel"));
const CommandPalette = lazy(() => import("../shell/CommandPalette"));
const DashboardItemDetailSheet = lazy(() => import("./DashboardItemDetailSheet"));

export default function DashboardShellOverlays({
  isMobile,
  itemSheet,
  closeItemSheet,
  onOpenItemInCalendar,
  billCtx,
  accent,
  addTaskOpen,
  setAddTaskOpen,
  handleAddTask,
  queueCalendarDeadlineRefresh,
  paletteOpen,
  closePalette,
  handlePaletteAction,
  analyticsOpen,
  closeAnalytics,
  historyOpen,
  historicalSnapshotView,
  activeSnapshot,
  historyTriggerRef,
  handleSelectSnapshot,
  setHistoryOpen,
}: DashboardShellOverlaysProps) {
  return (
    <>
      {itemSheet && (
        <Suspense fallback={null}>
          <DashboardItemDetailSheet
            kind={itemSheet.kind}
            item={itemSheet.item as DashboardSheetItem}
            anchorRef={itemSheet.anchorRef as RefObject<HTMLElement | null>}
            accent={accent}
            ctx={itemSheet.kind === "bill" ? billCtx : undefined}
            onClose={closeItemSheet}
            onOpenInCalendar={() => onOpenItemInCalendar(itemSheet)}
          />
        </Suspense>
      )}

      {isMobile && addTaskOpen && (
        <Suspense fallback={null}>
          <AddTaskPanel
            host="anchored"
            onClose={() => setAddTaskOpen(false)}
            onTaskAdded={(task) => {
              handleAddTask(task as DashboardDeadline);
              queueCalendarDeadlineRefresh();
              setAddTaskOpen(false);
            }}
          />
        </Suspense>
      )}

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            accent={accent}
            onClose={closePalette}
            onAction={handlePaletteAction}
          />
        </Suspense>
      )}

      <AnalyticsModalMount open={analyticsOpen} onClose={closeAnalytics} />

      {historyOpen && (
        <Suspense fallback={null}>
          <BriefingHistoryPanel
            activeId={historicalSnapshotView?.snapshot?.id ?? activeSnapshot?.snapshot?.snapshot?.id ?? null}
            triggerRef={historyTriggerRef}
            onSelectSnapshot={handleSelectSnapshot}
            onClose={() => setHistoryOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
