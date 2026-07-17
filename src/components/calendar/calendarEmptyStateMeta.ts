import { Calendar as CalendarIcon, Receipt } from "lucide-react";

const VIEW_META = {
  events: {
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
  },
  bills: {
    key: "bills",
    label: "Bills",
    icon: Receipt,
    accent: "var(--sp-green)",
    itemNoun: "bill",
    emptyDayLabel: "No bills",
    selectedDayLabel: "Clear billing day",
    cellLabel: "Nothing due here",
    cellDescription: "No bills land here",
    railDescription: "No bills land on this date. Keep it open as a quiet break in the billing rhythm.",
  },
};

export function getCalendarViewMeta(view: string) {
  const key = view === "bills" ? "bills" : "events";
  return VIEW_META[key];
}
