import { useCallback, useState } from "react";
import {
  type CalendarEventDraft,
  type CalendarRecurrenceDraft,
  normalizeRecurrenceDraft,
  parsePositiveInt,
  todayYmd,
} from "./calendarEventEditorModel";
import type { CalendarRecurrenceEnds } from "../../../../shared/types/calendar";

type RecurrenceDraftField = "frequency" | "interval" | "endsType" | "untilDate" | "count";

export interface EventRecurrenceDraftOptions {
  draft: CalendarEventDraft;
  clearFieldError: () => void;
}

export default function useEventRecurrenceDraft({ draft, clearFieldError }: EventRecurrenceDraftOptions) {
  const [recurrenceDraft, setRecurrenceDraft] = useState<CalendarRecurrenceDraft | null>(null);
  const [manualRecurrenceOverride, setManualRecurrenceOverride] = useState(false);

  const updateRecurrenceDraft = useCallback((field: RecurrenceDraftField, value: string | number) => {
    setManualRecurrenceOverride(true);
    setRecurrenceDraft((current) => {
      const existing = normalizeRecurrenceDraft(current, draft);
      if (field === "frequency") {
        return normalizeRecurrenceDraft({
          ...existing,
          frequency: String(value),
          weekdays: value === "weekly" ? existing.weekdays : [],
        }, draft);
      }
      if (field === "interval") {
        return {
          ...existing,
          interval: parsePositiveInt(value, 1),
        };
      }
      if (field === "endsType") {
        const ends: CalendarRecurrenceEnds = value === "onDate"
          ? { type: "onDate", untilDate: draft.startDate || todayYmd() }
          : value === "afterCount"
            ? { type: "afterCount", count: 1 }
            : { type: "never" };
        return normalizeRecurrenceDraft({
          ...existing,
          ends,
        }, draft);
      }
      if (field === "untilDate") {
        return normalizeRecurrenceDraft({
          ...existing,
          ends: { type: "onDate", untilDate: String(value) },
        }, draft);
      }
      if (field === "count") {
        return normalizeRecurrenceDraft({
          ...existing,
          ends: { type: "afterCount", count: parsePositiveInt(value, 1) },
        }, draft);
      }
      return existing;
    });
    clearFieldError();
  }, [clearFieldError, draft]);

  const selectRecurrencePreset = useCallback((frequency: string | null) => {
    setManualRecurrenceOverride(true);
    if (!frequency) {
      setRecurrenceDraft(null);
      clearFieldError();
      return;
    }
    setRecurrenceDraft((current) => normalizeRecurrenceDraft({
      ...current,
      frequency,
      interval: current?.interval || 1,
      ends: current?.ends || { type: "never" },
    }, draft));
    clearFieldError();
  }, [clearFieldError, draft]);

  const toggleRecurrenceWeekday = useCallback((weekday: string) => {
    setManualRecurrenceOverride(true);
    setRecurrenceDraft((current) => {
      const existing = normalizeRecurrenceDraft(current, draft);
      const weekdays = existing.weekdays.includes(weekday)
        ? existing.weekdays.filter((entry) => entry !== weekday)
        : [...existing.weekdays, weekday];
      return {
        ...existing,
        weekdays,
      };
    });
    clearFieldError();
  }, [clearFieldError, draft]);

  return {
    recurrenceDraft,
    setRecurrenceDraft,
    manualRecurrenceOverride,
    setManualRecurrenceOverride,
    updateRecurrenceDraft,
    selectRecurrencePreset,
    toggleRecurrenceWeekday,
  };
}
