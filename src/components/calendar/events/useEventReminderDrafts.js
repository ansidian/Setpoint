import { useCallback, useMemo, useState } from "react";
import {
  createEventReminderDraftFromCustom,
  createEventReminderDraftFromOffset,
  EVENT_REMINDER_PRESETS,
  getEventReminderPresetState,
} from "./calendarEventReminderModel";

export default function useEventReminderDrafts({ draft }) {
  const [eventReminders, setEventReminders] = useState([]);
  const [removedReminderIds, setRemovedReminderIds] = useState([]);
  const [reminderError, setReminderError] = useState(null);
  const [customReminder, setCustomReminder] = useState({ date: "", time: "" });

  const updateCustomReminder = useCallback((patch) => {
    setCustomReminder((current) => ({ ...current, ...patch }));
    setReminderError(null);
  }, []);

  const addReminderDraft = useCallback((nextReminder) => {
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

  const addEventReminderPreset = useCallback((offsetMinutes) => {
    addReminderDraft(createEventReminderDraftFromOffset({
      draft,
      offsetMinutes,
      existingReminders: eventReminders,
    }));
  }, [addReminderDraft, draft, eventReminders]);

  const addCustomEventReminder = useCallback((selection = null) => {
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

  const removeEventReminder = useCallback((reminder) => {
    if (reminder?.id) {
      setRemovedReminderIds((current) => (
        current.includes(reminder.id) ? current : [...current, reminder.id]
      ));
    }
    setEventReminders((current) => current.filter((entry) => {
      if (reminder?.id) return entry.id !== reminder.id;
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
