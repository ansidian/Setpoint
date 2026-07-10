import { lazy } from "react";

const loadCalendarModalShell = () => import("../../components/calendar/modal/CalendarModalShell.jsx");
const loadCalendarMobileAgenda = () => import("../../components/calendar/CalendarMobileAgenda.jsx");

export const CalendarModalShell = import.meta.env.MODE === "test"
  ? (await loadCalendarModalShell()).default
  : lazy(loadCalendarModalShell);

export const CalendarMobileAgenda = import.meta.env.MODE === "test"
  ? (await loadCalendarMobileAgenda()).default
  : lazy(loadCalendarMobileAgenda);
