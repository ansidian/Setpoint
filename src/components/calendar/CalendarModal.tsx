import useCalendarModalController from "../../hooks/calendar/useCalendarModalController";
import type { CalendarModalControllerOptions } from "../../hooks/calendar/useCalendarModalController";

export default function CalendarModal(props: Record<string, unknown>) {
  return useCalendarModalController(props as unknown as CalendarModalControllerOptions);
}
