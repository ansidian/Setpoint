import { lazy } from "react";

const loadCalendarModalShell = () => import("../../components/calendar/modal/CalendarModalShell");
const loadCalendarMobileAgenda = () => import("../../components/calendar/CalendarMobileAgenda.tsx");

export const CalendarModalShell = import.meta.env.MODE === "test"
  ? (await loadCalendarModalShell()).default
  : lazy(loadCalendarModalShell);

export const CalendarMobileAgenda = import.meta.env.MODE === "test"
  ? (await loadCalendarMobileAgenda()).default
  : lazy(loadCalendarMobileAgenda);
