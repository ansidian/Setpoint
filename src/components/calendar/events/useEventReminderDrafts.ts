import { useCallback, useMemo, useState } from "react";
import {
  createEventReminderDraftFromCustom,
  createEventReminderDraftFromOffset,
  type EventReminderDraftCandidate,
  type EventReminderLike,
  type EventReminderScheduleDraft,
  EVENT_REMINDER_PRESETS,
  getEventReminderPresetState,
} from "./calendarEventReminderModel";

export interface CustomReminderSelection { date: string; time: string }

export interface EventReminderDraftOptions { draft: EventReminderScheduleDraft }

export default function useEventReminderDrafts({ draft }: EventReminderDraftOptions) {
  const [eventReminders, setEventReminders] = useState<EventReminderLike[]>([]);
  const [removedReminderIds, setRemovedReminderIds] = useState<Array<string | number>>([]);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [customReminder, setCustomReminder] = useState<CustomReminderSelection>({ date: "", time: "" });

  const updateCustomReminder = useCallback((patch: Partial<CustomReminderSelection>) => {
    setCustomReminder((current) => ({ ...current, ...patch }));
    setReminderError(null);
  }, []);

  const addReminderDraft = useCallback((nextReminder: EventReminderDraftCandidate) => {
    if (nextReminder.blocked) {
      setReminderError(nextReminder.blockReason === "duplicate"
        ? "That reminder is already on this event."
        : nextReminder.blockReason === "past"
          ? "Choose a future reminder time."
          : "Choose an event start before adding a reminder.");
      return;
    }
    setEventReminders((current) => [...current, nextReminder]);
    setReminderError(null);
  }, []);

  const addEventReminderPreset = useCallback((offsetMinutes: number) => {
    addReminderDraft(createEventReminderDraftFromOffset({
      draft,
      offsetMinutes,
      existingReminders: eventReminders,
    }));
  }, [addReminderDraft, draft, eventReminders]);

  const addCustomEventReminder = useCallback((selection: CustomReminderSelection | null = null) => {
    const reminderSelection = selection || customReminder;
    addReminderDraft(createEventReminderDraftFromCustom({
      draft,
      reminderDate: reminderSelection.date,
      reminderTime: reminderSelection.time,
      existingReminders: eventReminders,
    }));
  }, [addReminderDraft, customReminder, draft, eventReminders]);

  const eventReminderPresetStates = useMemo(() => {
    return Object.fromEntries(EVENT_REMINDER_PRESETS.map((preset) => [
      preset.offsetMinutes,
      getEventReminderPresetState({
        draft,
        offsetMinutes: preset.offsetMinutes,
        existingReminders: eventReminders,
      }),
    ]));
  }, [draft, eventReminders]);

  const removeEventReminder = useCallback((reminder: EventReminderLike) => {
    const reminderId = reminder?.id;
    if (reminderId) {
      setRemovedReminderIds((current) => (
        current.includes(reminderId) ? current : [...current, reminderId]
      ));
    }
    setEventReminders((current) => current.filter((entry) => {
      if (reminderId) return entry.id !== reminderId;
      return entry.clientId !== reminder?.clientId;
    }));
    setReminderError(null);
  }, []);

  return {
    eventReminders,
    setEventReminders,
    removedReminderIds,
    setRemovedReminderIds,
    reminderError,
    setReminderError,
    customReminder,
    setCustomReminder,
    updateCustomReminder,
    addEventReminderPreset,
    addCustomEventReminder,
    removeEventReminder,
    eventReminderPresetStates,
  };
}
