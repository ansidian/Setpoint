import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseYmd } from "../../components/calendar/calendarDateUtils.ts";
import type { AgendaScrollCommand } from "./useCalendarScrollSync";

export interface AgendaRailHandle {
  scrollToToday?: (id: string) => void;
  scrollToDate?: (dateKey: string, id: string) => void;
  scrollToItem?: (itemId: string | number, dateKey: string, id: string) => void;
  activateItem?: (itemId: string, dateKey: string) => boolean;
  getItemAnchor?: (itemId: string | number, dateKey: string | null) => HTMLElement | null;
  scrollToEvent?: (itemId: string | number | null, dateKey: string) => void;
}

export type ControllerAgendaCommand = (
  AgendaScrollCommand
  | { type: "event" | "item"; itemId: string | number; dateKey: string }
) & { id?: string };

interface CalendarAgendaScrollOptions {
  open: boolean;
  openRequestId: number;
  view: string;
  focusDate?: string | null;
  todayDateKey: string;
  suppressAgendaPassiveSync: () => void;
}

export default function useCalendarAgendaScroll({
  open,
  openRequestId,
  view,
  focusDate,
  todayDateKey,
  suppressAgendaPassiveSync,
}: CalendarAgendaScrollOptions) {
  const [agendaScrollCommand, setAgendaScrollCommand] = useState<(ControllerAgendaCommand & { id: string }) | null>(null);
  const [agendaEntryScrollReleased, setAgendaEntryScrollReleased] = useState(false);
  const agendaRailRef = useRef<AgendaRailHandle | null>(null);

  const requestAgendaScroll = useCallback((command: ControllerAgendaCommand) => {
    suppressAgendaPassiveSync();
    setAgendaEntryScrollReleased(true);
    const scrollCommand = {
      ...command,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    } as ControllerAgendaCommand & { id: string };
    setAgendaScrollCommand(scrollCommand);
    window.requestAnimationFrame(() => {
      const rail = agendaRailRef.current;
      if (!rail) return;
      if (scrollCommand.type === "today") {
        rail.scrollToToday?.(scrollCommand.id);
      } else if (scrollCommand.type === "date") {
        rail.scrollToDate?.(scrollCommand.dateKey, scrollCommand.id);
      } else if (scrollCommand.type === "event" || scrollCommand.type === "item") {
        rail.scrollToItem?.(scrollCommand.itemId, scrollCommand.dateKey, scrollCommand.id);
      }
    });
  }, [suppressAgendaPassiveSync]);
  const clearAgendaScrollCommand = useCallback(() => setAgendaScrollCommand(null), []);

  const agendaEntryTargetDateKey = useMemo(() => {
    if (!open) return null;
    if (focusDate && parseYmd(focusDate)) return focusDate;
    return todayDateKey;
  }, [focusDate, open, todayDateKey]);

  useEffect(() => {
    // Reset the user-release latch when a new entry request becomes authoritative.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgendaEntryScrollReleased(false);
  }, [agendaEntryTargetDateKey, openRequestId, view]);

  useEffect(() => {
    if (open) return;
    // Closing the surface invalidates any imperative rail command.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgendaScrollCommand(null);
  }, [open]);

  return {
    agendaRailRef,
    agendaScrollCommand,
    agendaEntryTargetDateKey: agendaEntryScrollReleased ? false : agendaEntryTargetDateKey,
    clearAgendaScrollCommand,
    requestAgendaScroll,
    setAgendaEntryScrollReleased,
  };
}
