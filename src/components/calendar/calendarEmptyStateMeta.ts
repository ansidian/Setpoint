import { Calendar as CalendarIcon } from "lucide-react";

const EVENTS_VIEW_META = {
  key: "events",
  label: "Events",
  icon: CalendarIcon,
  accent: "var(--sp-blue)",
  itemNoun: "event",
  emptyDayLabel: "No events",
  selectedDayLabel: "Open day",
  cellLabel: "Nothing scheduled",
  cellDescription: "Month stays open",
  railDescription: "Nothing is scheduled here. The rest of the month stays in view while you scan.",
};

export function getCalendarViewMeta() {
  return EVENTS_VIEW_META;
}
