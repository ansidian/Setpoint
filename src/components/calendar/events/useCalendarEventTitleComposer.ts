import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureChrono,
  isChronoReady,
  parseCalendarTitle,
  subscribeChronoReady,
} from "./parseCalendarTitle";
import { coerceEditingTitleAssist } from "./calendarEventEditorModel";
import type {
  CalendarEventDraft,
  CalendarRecurrenceDraft,
  CalendarTitleAssist,
} from "./calendarEventEditorModel";
import type { CalendarRecurrenceScope } from "../../../../shared/types/calendar";

const TITLE_DEBOUNCE_MS = 120;

export interface CalendarEventTitleComposerOptions {
  createSeedDraft: CalendarEventDraft;
  draftTitle: string;
  isEditing: boolean;
  isEditingRecurring: boolean;
  recurringEditScope?: CalendarRecurrenceScope | null;
  touchedTitle: boolean;
  onInputStart: () => void;
  onCommitTitle: (value: string) => void;
}

export default function useCalendarEventTitleComposer({
  createSeedDraft,
  draftTitle,
  isEditing,
  isEditingRecurring,
  recurringEditScope,
  touchedTitle,
  onInputStart,
  onCommitTitle,
}: CalendarEventTitleComposerOptions) {
  const [titleInput, setTitleInput] = useState("");
  const titleInputRef = useRef("");
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [titleInputPending, setTitleInputPending] = useState(false);
  const [titleInputKey, setTitleInputKey] = useState(0);
  const [titleParseNow, setTitleParseNow] = useState(() => Date.now());
  const [chronoReadyTick, setChronoReadyTick] = useState(() => (isChronoReady() ? 1 : 0));

  useEffect(() => {
    if (!titleInput || isChronoReady()) return undefined;
    ensureChrono();
    const unsubscribe = subscribeChronoReady(() => setChronoReadyTick((tick) => tick + 1));
    return unsubscribe;
  }, [titleInput]);

  const parsedTitleAssist = useMemo(() => parseCalendarTitle(titleInput, {
    now: titleParseNow,
    baseDate: createSeedDraft.startDate,
    defaultStartTime: createSeedDraft.startTime,
    defaultEndTime: createSeedDraft.endTime,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-parse once chrono lands
  }), [createSeedDraft.endTime, createSeedDraft.startDate, createSeedDraft.startTime, titleInput, titleParseNow, chronoReadyTick]);

  const titleAssist = useMemo<CalendarTitleAssist>(() => (
    isEditing
      ? coerceEditingTitleAssist(parsedTitleAssist, {
          active: !!touchedTitle,
          fallbackTitle: draftTitle,
          isEditingRecurring,
          recurringEditScope,
        })
      : parsedTitleAssist
  ), [draftTitle, isEditing, isEditingRecurring, parsedTitleAssist, recurringEditScope, touchedTitle]);

  const intentState = useMemo<{
    mode: string;
    singleDraft: CalendarTitleAssist["singleDraft"];
    batchDrafts: CalendarTitleAssist["batchDrafts"];
    recurrenceDraft: CalendarRecurrenceDraft | null;
  }>(() => ({
    mode: titleAssist.mode || "single",
    singleDraft: titleAssist.singleDraft || null,
    batchDrafts: titleAssist.batchDrafts || [],
    recurrenceDraft: titleAssist.recurrenceDraft
      ? titleAssist.recurrenceDraft as CalendarRecurrenceDraft
      : null,
  }), [titleAssist.batchDrafts, titleAssist.mode, titleAssist.recurrenceDraft, titleAssist.singleDraft]);

  const effectiveTitle = useMemo(
    () => String(titleAssist.cleanTitle || "").trim(),
    [titleAssist.cleanTitle],
  );

  const cancelPendingTitle = useCallback(() => {
    if (!titleDebounceRef.current) return;
    clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = null;
  }, []);

  const seedTitleInput = useCallback((value: unknown) => {
    const nextValue = String(value || "");
    titleInputRef.current = nextValue;
    cancelPendingTitle();
    setTitleInput(nextValue);
    setTitleInputKey((key) => key + 1);
    setTitleParseNow(Date.now());
  }, [cancelPendingTitle]);

  const clearTitleInput = useCallback(() => {
    titleInputRef.current = "";
    cancelPendingTitle();
  }, [cancelPendingTitle]);

  const handleTitleInputChange = useCallback((value: string) => {
    titleInputRef.current = value;
    onInputStart();
    setTitleInputPending(true);

    cancelPendingTitle();
    titleDebounceRef.current = setTimeout(() => {
      titleDebounceRef.current = null;
      setTitleInputPending(false);
      setTitleInput(value);
      onCommitTitle(value);
    }, TITLE_DEBOUNCE_MS);
  }, [cancelPendingTitle, onCommitTitle, onInputStart]);

  const flushPendingTitle = useCallback(() => {
    if (!titleDebounceRef.current) return false;
    cancelPendingTitle();
    setTitleInput(titleInputRef.current);
    onCommitTitle(titleInputRef.current);
    return true;
  }, [cancelPendingTitle, onCommitTitle]);

  useEffect(() => () => {
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
  }, []);

  return {
    titleInput,
    titleInputRef,
    titleInputKey,
    titleInputPending,
    titleAssist,
    intentState,
    effectiveTitle,
    handleTitleInputChange,
    seedTitleInput,
    clearTitleInput,
    flushPendingTitle,
  };
}
