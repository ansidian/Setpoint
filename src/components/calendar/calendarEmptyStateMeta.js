import { Calendar as CalendarIcon, ListChecks, Receipt } from "lucide-react";

const VIEW_META = {
  events: {
    key: "events",
    label: "Events",
    icon: CalendarIcon,
    accent: "#89b4fa",
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
    accent: "#a6e3a1",
    itemNoun: "bill",
    emptyDayLabel: "No bills",
    selectedDayLabel: "Clear billing day",
    cellLabel: "Nothing due here",
    cellDescription: "No bills land here",
    railDescription: "No bills land on this date. Keep it open as a quiet break in the billing rhythm.",
  },
  deadlines: {
    key: "deadlines",
    label: "Deadlines",
    icon: ListChecks,
    accent: "var(--ea-accent)",
    itemNoun: "deadline",
    emptyDayLabel: "No deadlines",
    selectedDayLabel: "Open deadline day",
    cellLabel: "Nothing due here",
    cellDescription: "No deadlines land here",
    railDescription: "No deadlines are due on this date. The rest of the month stays visible while you plan ahead.",
  },
};

export function getCalendarViewMeta(view) {
  return VIEW_META[view] || VIEW_META.bills;
}
