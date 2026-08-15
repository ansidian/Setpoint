import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import type {
  CalendarEventCreateSeed,
  NormalizedCalendarEvent,
} from "../../../../shared/types/calendar";
import {
  completeCalendarEventCreateRequest,
  type CalendarEventCreateOpenResult,
  type CalendarEventCreateRequest,
} from "../../../hooks/calendar/calendarEventCreateBridge";
import type { CalendarEventEditorInput } from "./useCalendarEventEditorSession";

interface CalendarEventCreateCoordinationOptions {
  openCreateSession: (seed?: CalendarEventCreateSeed) => Promise<CalendarEventCreateOpenResult>;
  openEditSession: (event: CalendarEventEditorInput) => Promise<void>;
  setStructuredCreateSeed: Dispatch<SetStateAction<boolean>>;
  onSaved?: (event: NormalizedCalendarEvent | null, metadata: Record<string, unknown>) => void;
}

export default function useCalendarEventCreateCoordination({
  openCreateSession,
  openEditSession,
  setStructuredCreateSeed,
  onSaved,
}: CalendarEventCreateCoordinationOptions) {
  const activeRequestRef = useRef<CalendarEventCreateRequest | null>(null);

  const clearCreateCoordination = useCallback(() => {
    activeRequestRef.current = null;
    setStructuredCreateSeed(false);
  }, [setStructuredCreateSeed]);

  const openCreate = useCallback(async (request?: CalendarEventCreateRequest) => {
    activeRequestRef.current = request || null;
    setStructuredCreateSeed(!!request);
    const result = await openCreateSession(request?.seed);
    if (!result.accepted && activeRequestRef.current === request) clearCreateCoordination();
    return result;
  }, [clearCreateCoordination, openCreateSession, setStructuredCreateSeed]);

  const openEdit = useCallback(async (event: CalendarEventEditorInput) => {
    clearCreateCoordination();
    return openEditSession(event);
  }, [clearCreateCoordination, openEditSession]);

  const handleSaved = useCallback((
    savedEvent: NormalizedCalendarEvent | null,
    metadata: Record<string, unknown>,
  ) => {
    onSaved?.(savedEvent, metadata);
    if (!savedEvent) return;
    const request = activeRequestRef.current;
    if (!request) return;
    clearCreateCoordination();
    completeCalendarEventCreateRequest(request, { event: savedEvent, origin: request.origin });
  }, [clearCreateCoordination, onSaved]);

  return {
    clearCreateCoordination,
    openCreate,
    openEdit,
    handleSaved,
  };
}
