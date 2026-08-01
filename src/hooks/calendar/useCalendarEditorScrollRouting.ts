import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import useCalendarEventEditor, { type CalendarEventEditorOptions } from "../../components/calendar/events/useCalendarEventEditor";
import useCalendarScrollSync, { type CalendarScrollSyncOptions } from "./useCalendarScrollSync";
import useFloatingEditorRouting, { type FloatingEditorRoutingOptions } from "./useFloatingEditorRouting";
import type { CalendarFloatingDetail } from "./useCalendarFloatingDetail";

interface CalendarEditorScrollRoutingOptions {
  sync: Omit<CalendarScrollSyncOptions, "isDirtyCheck" | "isEditorOpenCheck">;
  routing: Omit<FloatingEditorRoutingOptions, "eventEditorRef">;
  event: Omit<CalendarEventEditorOptions, "onSaved" | "onDeleted">;
  floatingDetailRef: MutableRefObject<CalendarFloatingDetail | null>;
}

/** Couples editor state with the scroll guards that must consult it synchronously. */
export default function useCalendarEditorScrollRouting({
  sync: syncOptions,
  routing: routingOptions,
  event: eventOptions,
  floatingDetailRef,
}: CalendarEditorScrollRoutingOptions) {
  const eventEditorRef = useRef<ReturnType<typeof useCalendarEventEditor> | null>(null);

  function isEditorDirty() {
    const current = floatingDetailRef.current;
    return !!(
      (current?.open && (current.mode === "edit" || current.mode === "create") && current.dirty)
      || (eventEditorRef.current?.isEditorOpen && eventEditorRef.current?.isDirty)
    );
  }
  function isEditorOpen() {
    const current = floatingDetailRef.current;
    return !!(
      (current?.open && (current.mode === "edit" || current.mode === "create"))
      || eventEditorRef.current?.isEditorOpen
      || routing.deadlineEditor?.mode
    );
  }

  const sync = useCalendarScrollSync({
    ...syncOptions,
    isDirtyCheck: isEditorDirty,
    isEditorOpenCheck: isEditorOpen,
  });
  const routing = useFloatingEditorRouting({ ...routingOptions, eventEditorRef });
  const eventEditor = useCalendarEventEditor({
    ...eventOptions,
    onSaved: routing.handleEventEditorSaved,
    onDeleted: routing.handleEventEditorDeleted,
  });

  useLayoutEffect(() => {
    eventEditorRef.current = eventEditor;
  }, [eventEditor]);

  return { sync, routing, eventEditor, eventEditorRef, isEditorDirty };
}
