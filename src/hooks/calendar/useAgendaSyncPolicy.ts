import { useCallback, useRef } from "react";
import { floatingDetailOwnsGridSelection } from "./calendarFloatingDetailModel";
import type { CalendarFloatingDetailState } from "./calendarFloatingDetailModel";

export const AGENDA_PASSIVE_SYNC_SUPPRESS_MS = 900;

/**
 * Owns the agenda selection-sync policy (D-CAL-11).
 *
 * The agenda rail emits two kinds of date signals:
 *   - "hover"  → passive sync: follow the hovered date only if nothing else owns
 *                the selection (no recent explicit action, no grid-anchored detail).
 *   - "select" → active sync: an explicit user action that always wins.
 *
 * `suppressAgendaPassiveSync(durationMs)` opens a short window during which passive
 * (hover) sync is ignored — used right after an explicit action (scroll, event open,
 * dashboard focus) so a stray hover doesn't immediately override it. This replaces
 * the bare `agendaPassiveSyncSuppressedUntilRef` timestamp the controller carried.
 *
 * `shouldIgnorePassiveAgendaSync(floatingDetail)` is the single passive-sync gate:
 * true while the suppression window is open, or while a grid-anchored floating detail
 * owns the current selection.
 */
export interface AgendaSyncPolicyController {
  suppressAgendaPassiveSync(durationMs?: number): void;
  shouldIgnorePassiveAgendaSync(floatingDetail: CalendarFloatingDetailState | null | undefined): boolean;
}

export default function useAgendaSyncPolicy(): AgendaSyncPolicyController {
  const suppressedUntilRef = useRef(0);

  const suppressAgendaPassiveSync = useCallback((durationMs: number = AGENDA_PASSIVE_SYNC_SUPPRESS_MS) => {
    suppressedUntilRef.current = Math.max(
      suppressedUntilRef.current,
      performance.now() + durationMs,
    );
  }, []);

  const shouldIgnorePassiveAgendaSync = useCallback((floatingDetail: CalendarFloatingDetailState | null | undefined) => (
    performance.now() < suppressedUntilRef.current
    || floatingDetailOwnsGridSelection(floatingDetail)
  ), []);

  return { suppressAgendaPassiveSync, shouldIgnorePassiveAgendaSync };
}
