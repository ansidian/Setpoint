import { useEffect, useEffectEvent, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { CalendarModalSyncSnapshot } from "./calendarModalSelectionModel";
import type { CalendarFloatingDetail } from "./useCalendarFloatingDetail";
import type { DeadlineEditorState } from "./useFloatingEditorRouting";
import {
  acknowledgeCalendarEventCreateRequest,
  type CalendarEventCreateOpenResult,
  type CalendarEventCreateRequest,
} from "./calendarEventCreateBridge";

interface OpenRequestState {
  open: boolean;
  view: string;
  openRequestId: number;
  focusDate?: string | null;
  focusItemId?: string | null;
  forceDeadlineOverlay: boolean;
  usesFloatingEditor: boolean;
  activeSelectedDateKey: string | null;
  todayDateKey: string;
  eventCreateRequest?: CalendarEventCreateRequest | null;
}

interface OpenRequestEditors {
  eventEditorEditable: boolean;
  closeEventEditor: () => void;
  openEventCreate: (request?: CalendarEventCreateRequest) => Promise<CalendarEventCreateOpenResult>;
  openFloatingEventCreate: (
    dateKey?: string | null,
    request?: CalendarEventCreateRequest,
  ) => Promise<CalendarEventCreateOpenResult> | void;
  openFloatingDeadlineCreate: (
    dateKey?: string | null,
    options?: { allowSelectionFallback?: boolean },
  ) => void;
  setDeadlineEditor: Dispatch<SetStateAction<DeadlineEditorState | null>>;
  setDeadlineDraftPreview: Dispatch<SetStateAction<Record<string, unknown> | null>>;
}

interface OpenRequestFloating {
  detailRef: MutableRefObject<CalendarFloatingDetail | null>;
  setDetail: Dispatch<SetStateAction<CalendarFloatingDetail | null>>;
}

interface CalendarOpenRequestRoutingOptions {
  request: OpenRequestState;
  syncSnapshot: CalendarModalSyncSnapshot | null;
  commitSyncSnapshot: (
    snapshot: CalendarModalSyncSnapshot | null,
    state: { open: boolean; view: string; openRequestId: number },
  ) => void;
  clearAgendaScrollCommand: () => void;
  editors: OpenRequestEditors;
  floating: OpenRequestFloating;
}

/** Applies open-request create intent and commits selection snapshots in order. */
export default function useCalendarOpenRequestRouting({
  request,
  syncSnapshot,
  commitSyncSnapshot,
  clearAgendaScrollCommand,
  editors,
  floating,
}: CalendarOpenRequestRoutingOptions) {
  const handledInitialDeadlineCreateRef = useRef<string | null>(null);
  const handledEventCreateRequestRef = useRef<string | null>(null);

  const routeEventCreateRequest = useEffectEvent(async (dateKey?: string | null) => {
    const createRequest = request.eventCreateRequest;
    if (!createRequest) return;
    const requestKey = String(request.openRequestId);
    if (handledEventCreateRequestRef.current === requestKey) return;
    handledEventCreateRequestRef.current = requestKey;

    let result: CalendarEventCreateOpenResult;
    try {
      const routedResult = request.usesFloatingEditor
        ? await editors.openFloatingEventCreate(dateKey || request.focusDate || null, createRequest)
        : await editors.openEventCreate(createRequest);
      result = routedResult || { accepted: false, reason: "editor_unavailable" };
    } catch {
      result = { accepted: false, reason: "seed_rejected" };
    }
    acknowledgeCalendarEventCreateRequest(createRequest, result);
  });

  useEffect(() => {
    if (
      !request.open
      || request.view !== "events"
      || request.focusItemId !== "new"
      || !request.eventCreateRequest
    ) return undefined;
    const frame = window.requestAnimationFrame(() => {
      void routeEventCreateRequest(request.focusDate || request.activeSelectedDateKey || null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    request.activeSelectedDateKey,
    request.eventCreateRequest,
    request.focusDate,
    request.focusItemId,
    request.open,
    request.openRequestId,
    request.view,
  ]);

  useEffect(() => {
    const shouldOpenDeadlineCreate = request.focusItemId === "new"
      && request.view === "events"
      && request.forceDeadlineOverlay;
    if (!request.open || !shouldOpenDeadlineCreate || !request.usesFloatingEditor) return;
    const requestKey = `${request.openRequestId}:${request.focusDate || ""}`;
    if (handledInitialDeadlineCreateRef.current === requestKey) return;
    handledInitialDeadlineCreateRef.current = requestKey;
    window.requestAnimationFrame(() => {
      if (!floating.detailRef.current?.open) {
        editors.openFloatingDeadlineCreate(
          request.focusDate || request.activeSelectedDateKey || request.todayDateKey,
          { allowSelectionFallback: true },
        );
      }
    });
    // Initial create focus is keyed by the explicit open request, not every selection update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    request.open,
    request.view,
    request.focusItemId,
    request.openRequestId,
    request.focusDate,
    request.forceDeadlineOverlay,
    request.usesFloatingEditor,
  ]);

  const commitSyncSnapshotEffects = useEffectEvent((snapshot: CalendarModalSyncSnapshot | null) => {
    const createDeadlineSeedDate = request.focusDate
      || snapshot?.nextSelectedDateKey
      || request.activeSelectedDateKey
      || request.todayDateKey;
    if (snapshot?.didViewChange) {
      editors.closeEventEditor();
      editors.setDeadlineDraftPreview(null);
      floating.setDetail(null);
    }
    if (snapshot) clearAgendaScrollCommand();
    if (snapshot?.resetDeadlineEditor) floating.setDetail(null);
    if (snapshot?.openCreate && request.view === "events" && request.forceDeadlineOverlay) {
      if (request.usesFloatingEditor) {
        editors.openFloatingDeadlineCreate(createDeadlineSeedDate, { allowSelectionFallback: true });
      } else {
        editors.setDeadlineEditor({ mode: "create", seedDate: createDeadlineSeedDate });
      }
    } else if (snapshot?.openCreate && request.view === "events" && editors.eventEditorEditable) {
      if (request.eventCreateRequest) {
        void routeEventCreateRequest(request.focusDate || snapshot.nextSelectedDateKey || null);
      } else if (request.usesFloatingEditor) {
        editors.openFloatingEventCreate(request.focusDate || snapshot.nextSelectedDateKey || null);
      } else {
        editors.openEventCreate();
      }
    } else if (snapshot?.resetDeadlineEditor) {
      editors.setDeadlineEditor(null);
      editors.setDeadlineDraftPreview(null);
    }
    commitSyncSnapshot(snapshot, {
      open: request.open,
      view: request.view,
      openRequestId: request.openRequestId,
    });
  });

  useLayoutEffect(() => {
    commitSyncSnapshotEffects(syncSnapshot);
  }, [syncSnapshot, request.open, request.view, request.openRequestId]);
}
