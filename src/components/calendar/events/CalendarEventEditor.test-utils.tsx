/* eslint-disable react-refresh/only-export-components -- Test helpers intentionally co-locate a private harness with non-component exports. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { expect, vi } from "vitest";
import "../CalendarEventEditor.test-setup.ts";
import { buildEventGhostPreview } from "../ghostPreview.ts";
import CalendarEventEditorRail from "./CalendarEventEditorRail.tsx";
import useCalendarEventEditor from "./useCalendarEventEditor.ts";
import type {
  CalendarEventEditorInput,
  CalendarEventEditorOptions,
} from "./useCalendarEventEditor.ts";
import type { CalendarDraftGhostPreview } from "./CalendarDraftPreviewPanel.tsx";
import type { CalendarEventLike, EventEditorLike } from "../ghostPreview.ts";

type CalendarEventEditor = ReturnType<typeof useCalendarEventEditor>;
type RefreshRange = NonNullable<CalendarEventEditorOptions["refreshRange"]>;
type UpsertEvents = NonNullable<CalendarEventEditorOptions["upsertEvents"]>;
type RemoveEvent = NonNullable<CalendarEventEditorOptions["removeEvent"]>;
type FocusDate = NonNullable<CalendarEventEditorOptions["onFocusDate"]>;
type Saved = NonNullable<CalendarEventEditorOptions["onSaved"]>;
type Deleted = NonNullable<CalendarEventEditorOptions["onDeleted"]>;

interface EditorHarnessProps {
  event?: CalendarEventEditorInput | null;
  events: CalendarEventLike[];
  focusDate: string;
  refreshRange: RefreshRange;
  upsertEvents: UpsertEvents;
  removeEvent: RemoveEvent;
  onFocusDate: FocusDate;
  onSaved: Saved;
  onDeleted: Deleted;
  editorRef: { current: CalendarEventEditor | null };
}

function EditorHarness({
  event,
  events,
  focusDate,
  refreshRange,
  upsertEvents,
  removeEvent,
  onFocusDate,
  onSaved,
  onDeleted,
  editorRef,
}: EditorHarnessProps) {
  const [upsertedEvents, setUpsertedEvents] = useState<unknown[]>([]);
  const [removedEventIds, setRemovedEventIds] = useState<string[]>([]);
  const [refreshedBounds, setRefreshedBounds] = useState<Array<[string, string]>>([]);
  const observeRefreshRange = useCallback<RefreshRange>(async (start, end) => {
    setRefreshedBounds((current) => [...current, [start, end]]);
    return refreshRange(start, end);
  }, [refreshRange]);
  const observeUpsertEvents = useCallback<UpsertEvents>((input) => {
    setUpsertedEvents((current) => [...current, input]);
    return upsertEvents(input);
  }, [upsertEvents]);
  const observeRemoveEvent = useCallback<RemoveEvent>((id) => {
    setRemovedEventIds((current) => [...current, id]);
    return removeEvent(id);
  }, [removeEvent]);
  const editor = useCalendarEventEditor({
    open: true,
    view: "events",
    editable: true,
    selectedDate: focusDate,
    viewYear: Number(focusDate.slice(0, 4)),
    viewMonth: Number(focusDate.slice(5, 7)) - 1,
    refreshRange: observeRefreshRange,
    upsertEvents: observeUpsertEvents,
    removeEvent: observeRemoveEvent,
    onFocusDate,
    onSaved,
    onDeleted,
  });
  const startedRef = useRef(false);

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (event ? editor.openEdit(event) : editor.openCreate());
  }, [editor, event]);

  // The production ghost adapter serializes this hook result into the narrower
  // EventEditorLike shape. The focused harness can pass the same runtime data
  // directly; these casts bridge only nullable/index-signature differences.
  const ghostPreview = editor.isEditorOpen ? buildEventGhostPreview({
    editor: editor as unknown as EventEditorLike,
    events,
  }) as CalendarDraftGhostPreview | null : null;
  return (
    <>
      <output data-testid="calendar-editor-observed-upserts">{JSON.stringify(upsertedEvents)}</output>
      <output data-testid="calendar-editor-observed-removals">{JSON.stringify(removedEventIds)}</output>
      <output data-testid="calendar-editor-observed-refreshes">{JSON.stringify(refreshedBounds)}</output>
      {editor.isEditorOpen ? <CalendarEventEditorRail editor={editor} ghostPreview={ghostPreview} host="floating" /> : null}
    </>
  );
}

export function renderEventEditor({
  event = null,
  events = [],
  focusDate = "2026-04-20",
  refreshRange = vi.fn<RefreshRange>().mockResolvedValue([]),
  upsertEvents = vi.fn<UpsertEvents>(),
  removeEvent = vi.fn<RemoveEvent>(),
  onFocusDate = vi.fn<FocusDate>(),
  onSaved = vi.fn<Saved>(),
  onDeleted = vi.fn<Deleted>(),
}: {
  event?: CalendarEventEditorInput | null;
  events?: CalendarEventLike[];
  focusDate?: string;
  refreshRange?: RefreshRange;
  upsertEvents?: UpsertEvents;
  removeEvent?: RemoveEvent;
  onFocusDate?: FocusDate;
  onSaved?: Saved;
  onDeleted?: Deleted;
} = {}) {
  const editorRef = { current: null as CalendarEventEditor | null };
  const result = render(
    <EditorHarness
      event={event}
      events={events}
      focusDate={focusDate}
      refreshRange={refreshRange}
      upsertEvents={upsertEvents}
      removeEvent={removeEvent}
      onFocusDate={onFocusDate}
      onSaved={onSaved}
      onDeleted={onDeleted}
      editorRef={editorRef}
    />,
  );
  return {
    ...result,
    editorRef,
    refreshRange,
    upsertEvents,
    removeEvent,
    onFocusDate,
    onSaved,
    onDeleted,
  };
}

export function getActiveEventSourceTrigger() {
  return (screen.getAllByTestId("calendar-event-source-trigger") as HTMLButtonElement[])
    .find((element) => !element.disabled)!;
}

export function getActiveEventSaveButton() {
  return (screen.getAllByTestId("calendar-event-save") as HTMLButtonElement[])
    .find((element) => !element.disabled)!;
}

export function getActiveRepeatTrigger(labelPattern: RegExp | null = null) {
  const matches = (screen.getAllByTestId("calendar-event-repeat-trigger") as HTMLButtonElement[])
    .filter((element) => !element.disabled)
    .filter((element) => !labelPattern || labelPattern.test(element.getAttribute("aria-label") || ""));
  return matches[matches.length - 1]!;
}

export function setCompactSchedulePickerTime(
  picker: HTMLElement,
  fieldLabel: string,
  { hour, minute, period }: { hour: number | string; minute: number | string; period: string },
) {
  const fieldButton = within(picker).getByRole("button", { name: new RegExp(`^${fieldLabel}:`, "i") });
  if (fieldButton.getAttribute("aria-pressed") !== "true") {
    fireEvent.click(fieldButton);
  }
  fireEvent.change(within(picker).getByLabelText("hour"), { target: { value: String(hour) } });
  fireEvent.blur(within(picker).getByLabelText("hour"));
  fireEvent.change(within(picker).getByLabelText("minute"), { target: { value: String(minute).padStart(2, "0") } });
  fireEvent.blur(within(picker).getByLabelText("minute"));
  fireEvent.click(within(picker).getByRole("button", { name: period.toUpperCase() }));
  fireEvent.click(within(picker).getByRole("button", { name: new RegExp(`set ${fieldLabel}`, "i") }));
}

export async function typeTitle(value: string) {
  const input = screen.getByTestId("calendar-event-title") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  await waitFor(() => {
    expect((screen.getByTestId("calendar-event-save") as HTMLButtonElement).disabled).toBe(false);
  });
}

export function commitTitleWithoutWallClock(value: string) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(screen.getByTestId("calendar-event-title"), {
    target: { value },
  });
  act(() => {
    vi.runOnlyPendingTimers();
  });
  // React flushes effects after the title timer commits. Parsed location
  // assistance schedules its own debounce in that effect, so drain that second
  // deterministic layer before restoring the real clock.
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
}

export function createDeferred<T = unknown>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
