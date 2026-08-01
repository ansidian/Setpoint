import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { getGmailAuthUrl } from "@/api";
import type {
  CalendarRecurrenceScope,
  NormalizedCalendarEvent,
} from "../../../../shared/types/calendar";
import type { EventReminderLike } from "./calendarEventReminderModel";
import type {
  CalendarBatchDraft,
  CalendarEventDraft,
  CalendarRecurrenceDraft,
} from "./calendarEventEditorModel";
import { getCalendarEditorErrorDetails } from "./calendarEventEditorErrors";
import {
  deleteCalendarEventAction,
  formatCalendarEditorError,
  saveCalendarEventAction,
} from "./calendarEventEditorActions";

type EditorMode = "detail" | "editor";
type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface CalendarEventMutationState {
  draft: CalendarEventDraft;
  batchDrafts: CalendarBatchDraft[];
  effectiveTitle: string;
  recurrenceDraft: CalendarRecurrenceDraft | null;
  editingEvent: NormalizedCalendarEvent | null;
  isEditingRecurring: boolean;
  recurringEditScope: CalendarRecurrenceScope | null;
  intentMode: string;
  eventReminders: EventReminderLike[];
  removedReminderIds: Array<string | number>;
  validationMessage: string | null;
  titleLocationQuery?: string | null;
}

interface CalendarEventMutationSetters {
  setMode: StateSetter<EditorMode>;
  setEditingEvent: StateSetter<NormalizedCalendarEvent | null>;
  setBatchDrafts: StateSetter<CalendarBatchDraft[]>;
  setEventReminders: StateSetter<EventReminderLike[]>;
  setRemovedReminderIds: StateSetter<Array<string | number>>;
  setError: StateSetter<string | null>;
  setErrorCode: StateSetter<string | null>;
  setSaveAttempted: StateSetter<boolean>;
  setSaving: StateSetter<boolean>;
  setDeleting: StateSetter<boolean>;
  setConfirmDelete: StateSetter<boolean>;
}

interface CalendarEventMutationEffects {
  flushPendingTitle: () => boolean;
  acceptActiveLocationSuggestion: () => Promise<string | false | null>;
  refreshRange?: (start: string, end: string) => Promise<unknown> | unknown;
  upsertEvents?: (events: NormalizedCalendarEvent | NormalizedCalendarEvent[]) => void;
  removeEvent?: (eventId: string) => void;
  onFocusDate?: (date: string) => void;
  onSaved?: (event: NormalizedCalendarEvent | null, metadata: Record<string, unknown>) => void;
  onDeleted?: (event: NormalizedCalendarEvent) => void;
  closeEditor: () => void;
}

interface UseCalendarEventMutationsOptions {
  editable: boolean;
  state: CalendarEventMutationState;
  setters: CalendarEventMutationSetters;
  effects: CalendarEventMutationEffects;
}

export default function useCalendarEventMutations({
  editable,
  state,
  setters,
  effects,
}: UseCalendarEventMutationsOptions) {
  const pendingSaveRef = useRef(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const {
    draft,
    batchDrafts,
    effectiveTitle,
    recurrenceDraft,
    editingEvent,
    isEditingRecurring,
    recurringEditScope,
    intentMode,
    eventReminders,
    removedReminderIds,
    validationMessage,
    titleLocationQuery,
  } = state;
  const {
    setMode,
    setEditingEvent,
    setBatchDrafts,
    setEventReminders,
    setRemovedReminderIds,
    setError,
    setErrorCode,
    setSaveAttempted,
    setSaving,
    setDeleting,
    setConfirmDelete,
  } = setters;
  const {
    flushPendingTitle,
    acceptActiveLocationSuggestion,
    refreshRange,
    upsertEvents,
    removeEvent,
    onFocusDate,
    onSaved,
    onDeleted,
    closeEditor,
  } = effects;

  const save = useCallback(async () => {
    if (!editable) return;
    setSaveAttempted(true);
    if (flushPendingTitle()) {
      pendingSaveRef.current = true;
      return;
    }
    pendingSaveRef.current = false;
    if (validationMessage || savingRef.current) return;
    if (titleLocationQuery && draft.location === titleLocationQuery) {
      savingRef.current = true;
      let resolvedLocation = null;
      try {
        resolvedLocation = await acceptActiveLocationSuggestion();
      } finally {
        savingRef.current = false;
      }
      if (resolvedLocation) {
        pendingSaveRef.current = true;
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setErrorCode(null);

    try {
      const result = await saveCalendarEventAction({
        draft,
        batchDrafts,
        effectiveTitle,
        recurrenceDraft,
        editingEvent,
        isEditingRecurring,
        recurringEditScope,
        intentMode: (intentMode !== "batch" && recurrenceDraft
          ? "recurring"
          : intentMode) as "single" | "batch" | "recurring",
        eventReminders: { items: eventReminders, removedIds: removedReminderIds },
      });

      if (result.kind === "batch-create") {
        if (result.shouldRefresh && result.bounds) await refreshRange?.(result.bounds.start, result.bounds.end);
        else if (result.shouldUpsert) upsertEvents?.(result.createdEvents);
        if (result.focusDate) onFocusDate?.(result.focusDate);

        if (result.failed.length) {
          setBatchDrafts(result.failedDrafts);
          setError(result.errorMessage);
          setErrorCode(result.errorCode);
          return;
        }

        setMode("detail");
        setEditingEvent(null);
        setConfirmDelete(false);
        setBatchDrafts([]);
        setEventReminders([]);
        setRemovedReminderIds([]);
        onSaved?.(result.createdEvents[0] || null, {
          kind: "batch-create",
          createdEvents: result.createdEvents,
        });
        return;
      }

      if (result.shouldRefresh && result.bounds) await refreshRange?.(result.bounds.start, result.bounds.end);
      else if (result.shouldUpsert) upsertEvents?.(result.savedEvent);
      if (result.focusDate) onFocusDate?.(result.focusDate);
      setMode("detail");
      setEditingEvent(null);
      setConfirmDelete(false);
      setEventReminders([]);
      setRemovedReminderIds([]);
      onSaved?.(result.savedEvent, { kind: result.kind });
    } catch (error) {
      setError(formatCalendarEditorError(error, "Failed to save event."));
      setErrorCode(getCalendarEditorErrorDetails(error, "Failed to save event.").code);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [acceptActiveLocationSuggestion, batchDrafts, draft, editable, editingEvent, effectiveTitle, eventReminders, flushPendingTitle, intentMode, isEditingRecurring, onFocusDate, onSaved, recurrenceDraft, recurringEditScope, refreshRange, removedReminderIds, setBatchDrafts, setConfirmDelete, setEditingEvent, setError, setErrorCode, setEventReminders, setMode, setRemovedReminderIds, setSaveAttempted, setSaving, titleLocationQuery, upsertEvents, validationMessage]);

  useEffect(() => {
    if (!pendingSaveRef.current) return;
    pendingSaveRef.current = false;
    save();
  });

  const reconnect = useCallback(async () => {
    try {
      const { url } = await getGmailAuthUrl();
      window.location.href = url;
    } catch (error) {
      const details = getCalendarEditorErrorDetails(error, "Failed to start Gmail reconnect.");
      setError(details.message);
      setErrorCode(details.code);
    }
  }, [setError, setErrorCode]);

  const confirmDeleteIntent = useCallback(() => {
    if (isEditingRecurring && !recurringEditScope) return;
    setConfirmDelete(true);
    setError(null);
    setErrorCode(null);
  }, [isEditingRecurring, recurringEditScope, setConfirmDelete, setError, setErrorCode]);

  const cancelDelete = useCallback(() => {
    setConfirmDelete(false);
  }, [setConfirmDelete]);

  const remove = useCallback(async () => {
    if (!editingEvent || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    setErrorCode(null);
    try {
      const result = await deleteCalendarEventAction({
        editingEvent,
        isEditingRecurring,
        recurringEditScope,
      });
      if (result.shouldRefresh && result.bounds) {
        await refreshRange?.(result.bounds.start, result.bounds.end);
      } else if (result.shouldRemove) {
        removeEvent?.(editingEvent.id);
      }
      onDeleted?.(editingEvent);
      closeEditor();
    } catch (error) {
      const details = getCalendarEditorErrorDetails(error, "Failed to delete event.");
      setError(details.message);
      setErrorCode(details.code);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [closeEditor, editingEvent, isEditingRecurring, onDeleted, recurringEditScope, refreshRange, removeEvent, setDeleting, setError, setErrorCode]);

  return {
    save,
    reconnect,
    confirmDeleteIntent,
    cancelDelete,
    remove,
  };
}
