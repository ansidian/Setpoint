import { Suspense, type ReactElement, type ReactNode } from "react";
import buildCalendarModalShellProps, { type BuildCalendarModalShellPropsInput } from "../../components/calendar/modal/buildCalendarModalShellProps";
import { CalendarMobileAgenda, CalendarModalShell } from "./calendarShellLoaders";

type LooseShellInput = {
  [Key in keyof Omit<BuildCalendarModalShellPropsInput, "editors">]: unknown;
};

type CalendarControllerShellOptions = LooseShellInput & {
  mobileShellActions?: ReactNode;
  open: boolean;
  isMobile: boolean;
  eventEditor: object;
  editorOverlays: {
    view: string;
    eventOverlayVisible: boolean;
    toggleEventOverlay: () => void;
    deadlineOverlayVisible: boolean;
    completedDeadlineOverlayVisible: boolean;
    planningReadiness: unknown;
    lateDeadlinesReady: boolean;
    toggleDeadlineOverlay: () => void;
    toggleCompletedDeadlineOverlay: () => void;
    onApplyLateDeadlines?: (() => void) | null;
  };
  editorState: object;
};

/** Builds the shared mobile/desktop shell contract and selects its renderer. */
export default function useCalendarControllerShell({
  open,
  mobileShellActions,
  isMobile,
  eventEditor,
  editorOverlays,
  editorState,
  ...input
}: CalendarControllerShellOptions): ReactElement | null {
  if (!open) return null;
  const shellProps = buildCalendarModalShellProps({
    ...input,
    editors: {
      eventEditor: {
        ...eventEditor,
        eventOverlay: editorOverlays.view === "events"
          ? {
              enabled: editorOverlays.eventOverlayVisible,
              onToggle: editorOverlays.toggleEventOverlay,
            }
          : null,
        deadlineOverlay: editorOverlays.view === "events"
          ? {
              enabled: editorOverlays.deadlineOverlayVisible,
              showCompleted: editorOverlays.completedDeadlineOverlayVisible,
              readiness: editorOverlays.planningReadiness,
              lateDeadlinesReady: editorOverlays.lateDeadlinesReady,
              onToggle: editorOverlays.toggleDeadlineOverlay,
              onToggleCompleted: editorOverlays.deadlineOverlayVisible
                ? editorOverlays.toggleCompletedDeadlineOverlay
                : undefined,
              onApplyLateDeadlines: editorOverlays.onApplyLateDeadlines,
            }
          : null,
      },
      ...editorState,
    },
  } as unknown as BuildCalendarModalShellPropsInput);

  return (
    <Suspense fallback={null}>
      {isMobile ? <CalendarMobileAgenda {...shellProps} mobileShellActions={mobileShellActions} /> : <CalendarModalShell {...shellProps} />}
    </Suspense>
  );
}
