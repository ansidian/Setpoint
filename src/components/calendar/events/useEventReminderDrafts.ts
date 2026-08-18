import { useCallback, useMemo, useState } from "react";
import { deleteReminder } from "@/api";
import {
  createEventReminderDraftFromCustom,
  createEventReminderDraftFromOffset,
  type EventReminderDraftCandidate,
  type EventReminderLike,
  type EventReminderScheduleDraft,
  EVENT_REMINDER_PRESETS,
  createTimeToLeaveDraft,
  findTimeToLeaveReminder,
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

  const timeToLeaveReminder = useMemo(
    () => findTimeToLeaveReminder(eventReminders),
    [eventReminders],
  );

  const enableTimeToLeave = useCallback(() => {
    setEventReminders((current) => (
      findTimeToLeaveReminder(current) ? current : [...current, createTimeToLeaveDraft()]
    ));
    setReminderError(null);
  }, []);

  const updateTimeToLeaveBuffer = useCallback((arrivalBufferMinutes: number) => {
    if (!Number.isInteger(arrivalBufferMinutes) || arrivalBufferMinutes < 0 || arrivalBufferMinutes > 120) {
      setReminderError("Arrival buffer must be a whole number from 0 through 120 minutes.");
      return;
    }
    setEventReminders((current) => current.map((reminder) => {
      if (reminder.reminder_kind !== "time_to_leave" || reminder.status === "missed") return reminder;
      if (reminder.id) {
        setRemovedReminderIds((ids) => (
          ids.includes(reminder.id!) ? ids : [...ids, reminder.id!]
        ));
        return {
          ...reminder,
          id: null,
          clientId: `time-to-leave-${arrivalBufferMinutes}`,
          arrival_buffer_minutes: arrivalBufferMinutes,
          route_status: null,
        };
      }
      return { ...reminder, arrival_buffer_minutes: arrivalBufferMinutes };
    }));
    setReminderError(null);
  }, []);

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

  const removeTimeToLeave = useCallback(async () => {
    const reminder = findTimeToLeaveReminder(eventReminders);
    if (!reminder) return;
    if (!reminder.id) {
      removeEventReminder(reminder);
      return;
    }

    setEventReminders((current) => current.filter((entry) => entry.id !== reminder.id));
    setReminderError(null);
    try {
      await deleteReminder(reminder.id);
    } catch {
      setEventReminders((current) => (
        current.some((entry) => entry.id === reminder.id) ? current : [...current, reminder]
      ));
      setReminderError("Time to Leave could not be removed. The reminder was restored; try again.");
    }
  }, [eventReminders, removeEventReminder]);

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
    timeToLeaveReminder,
    enableTimeToLeave,
    updateTimeToLeaveBuffer,
    removeTimeToLeave,
  };
}
