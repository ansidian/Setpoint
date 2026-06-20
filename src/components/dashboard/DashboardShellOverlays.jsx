import { lazy, Suspense } from "react";
import { AnalyticsModalMount } from "../shell/AnalyticsModalMount.jsx";

const AddTaskPanel = lazy(() => import("../todoist/AddTaskPanel"));
const BriefingHistoryPanel = lazy(() => import("../briefing/BriefingHistoryPanel"));
const CommandPalette = lazy(() => import("../shell/CommandPalette"));
const DeadlineDetailPopover = lazy(() => import("./DeadlineDetailPopover"));

export default function DashboardShellOverlays({
  isMobile,
  deadlinePopover,
  setDeadlinePopover,
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
}) {
  return (
    <>
      {isMobile && deadlinePopover && (
        <Suspense fallback={null}>
          <DeadlineDetailPopover
            task={deadlinePopover.task}
            anchor={deadlinePopover.anchor}
            accent={accent}
            onClose={() => setDeadlinePopover(null)}
          />
        </Suspense>
      )}

      {isMobile && addTaskOpen && (
        <Suspense fallback={null}>
          <AddTaskPanel
            host="anchored"
            onClose={() => setAddTaskOpen(false)}
            onTaskAdded={(task) => {
              handleAddTask(task);
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
