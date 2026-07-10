import { useCallback, useState } from "react";
import {
  normalizeRecurrenceDraft,
  parsePositiveInt,
  todayYmd,
} from "./calendarEventEditorModel";

export default function useEventRecurrenceDraft({ draft, clearFieldError }) {
  const [recurrenceDraft, setRecurrenceDraft] = useState(null);
  const [manualRecurrenceOverride, setManualRecurrenceOverride] = useState(false);

  const updateRecurrenceDraft = useCallback((field, value) => {
    setManualRecurrenceOverride(true);
    setRecurrenceDraft((current) => {
      const existing = normalizeRecurrenceDraft(current, draft);
      if (field === "frequency") {
        return normalizeRecurrenceDraft({
          ...existing,
          frequency: value,
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
        return normalizeRecurrenceDraft({
          ...existing,
          ends: value === "onDate"
            ? { type: "onDate", untilDate: draft.startDate || todayYmd() }
            : value === "afterCount"
              ? { type: "afterCount", count: 1 }
              : { type: "never" },
        }, draft);
      }
      if (field === "untilDate") {
        return {
          ...existing,
          ends: { type: "onDate", untilDate: value },
        };
      }
      if (field === "count") {
        return {
          ...existing,
          ends: { type: "afterCount", count: parsePositiveInt(value, 1) },
        };
      }
      return existing;
    });
    clearFieldError();
  }, [clearFieldError, draft]);

  const selectRecurrencePreset = useCallback((frequency) => {
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

  const toggleRecurrenceWeekday = useCallback((weekday) => {
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
