import { lazy, Suspense, useCallback, useState } from "react";
import useWarmImport from "../../hooks/useWarmImport";
import { AnalyticsModalMount } from "../shell/AnalyticsModalMount";
import CommandPalette from "../shell/CommandPalette";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { DashboardDeadline } from "../../context/dashboardTaskProjection";
import type { SnapshotView } from "../../../shared/types/snapshots";
import type { DashboardActiveSnapshotController } from "./useLiveReadOverrides";
import type { DashboardGlanceSheet } from "./dashboardShellModel";
import type { GlanceActionContext } from "./glanceActionsModel";
import type DashboardDetailSheetComponent from "./DashboardItemDetailSheet";
import type { DashboardSheetItem } from "./DashboardItemDetailSheet";
import type { CalendarRangeController } from "../../hooks/calendar/useCalendarRange";

interface DashboardShellOverlaysProps {
  isMobile: boolean;
  itemSheet: DashboardGlanceSheet | null;
  closeItemSheet: () => void;
  calendarRange: Partial<CalendarRangeController>;
  onEditorDirtyChange: (dirty: boolean) => void;
  onOpenEmail: (uid: string | number) => void;
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
  historicalSnapshotView: SnapshotView | null;
  activeSnapshot: DashboardActiveSnapshotController;
  historyTriggerRef: RefObject<HTMLElement | null>;
  handleSelectSnapshot: (snapshot: SnapshotView | null, meta?: { readOnly?: boolean }) => void;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
}

const AddTaskPanel = lazy(() => import("../todoist/AddTaskPanel"));
const BriefingHistoryPanel = lazy(() => import("../briefing/BriefingHistoryPanel"));
const importDashboardItemDetailSheet = () => import("./DashboardItemDetailSheet");
const DashboardItemDetailSheet = lazy(importDashboardItemDetailSheet);

export default function DashboardShellOverlays({
  isMobile,
  itemSheet,
  closeItemSheet,
  calendarRange,
  onEditorDirtyChange,
  onOpenItemInCalendar,
  onOpenEmail,
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
  // Preload after first paint and bypass the first lazy/Suspense commit once
  // ready; warming the import alone still delays the first detail's appearance.
  const [ReadyDetailSheet, setReadyDetailSheet] = useState<typeof DashboardDetailSheetComponent | null>(null);
  const warmDetailSheet = useCallback(async () => {
    const module = await importDashboardItemDetailSheet();
    setReadyDetailSheet(() => module.default);
  }, []);
  useWarmImport(warmDetailSheet);
  const DetailSheet = ReadyDetailSheet || DashboardItemDetailSheet;
  return (
    <>
      {itemSheet && (
        <Suspense fallback={null}>
          <DetailSheet
            kind={itemSheet.kind}
            calendarRange={calendarRange}
            onEditorDirtyChange={onEditorDirtyChange}
            item={itemSheet.item as DashboardSheetItem}
            anchorRef={itemSheet.anchorRef as RefObject<HTMLElement | null>}
            accent={accent}
            ctx={itemSheet.kind === "bill" ? billCtx : undefined}
            onClose={closeItemSheet}
            onOpenEmail={onOpenEmail}
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
        <CommandPalette
          open={paletteOpen}
          accent={accent}
          onClose={closePalette}
          onAction={handlePaletteAction}
        />
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
