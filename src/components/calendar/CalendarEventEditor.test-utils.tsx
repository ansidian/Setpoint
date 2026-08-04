import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import "./CalendarEventEditor.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { useState, type ComponentType } from "react";

const CalendarModalCompat = CalendarModal as unknown as ComponentType<Record<string, unknown>>;
interface RenderModalOptions { events?: Array<Record<string, unknown>>; focusDate?: string; refreshRange?: ReturnType<typeof vi.fn>; upsertEvents?: ReturnType<typeof vi.fn>; removeEvent?: ReturnType<typeof vi.fn> }

export function renderModal({
  events = [],
  focusDate = "2026-04-20",
  refreshRange = vi.fn().mockResolvedValue([]),
  upsertEvents = vi.fn(),
  removeEvent = vi.fn(),
}: RenderModalOptions = {}) {
  function CalendarHarness() {
    const [currentEvents, setCurrentEvents] = useState(events);
    const applyUpsert = (input: Record<string, unknown> | Array<Record<string, unknown>>) => {
      (upsertEvents as unknown as (value: typeof input) => void)(input);
      const incoming = Array.isArray(input) ? input : [input];
      setCurrentEvents((current) => {
        const next = [...current];
        for (const event of incoming) {
          const index = next.findIndex((candidate) => candidate.id === event.id);
          if (index >= 0) next[index] = event;
          else next.push(event);
        }
        return next;
      });
    };
    const applyRemove = (id: string) => {
      (removeEvent as unknown as (value: string) => void)(id);
      setCurrentEvents((current) => current.filter((event) => event.id !== id));
    };
    return (
      <CalendarModalCompat
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate={focusDate}
        eventsData={{
          editable: true,
          getEvents: () => currentEvents,
          refreshRange,
          upsertEvents: applyUpsert,
          removeEvent: applyRemove,
        }}
        billsData={{}}
        deadlinesData={{}}
      />
    );
  }
  const utils = render(<CalendarHarness />);
  return { ...utils, refreshRange, upsertEvents, removeEvent };
}

export async function openFloatingEventEditorFromSelectedChip() {
  fireEvent.click(screen.getAllByTestId("calendar-cell-item-chip")[0]!);
  const panel = await screen.findByTestId("calendar-floating-detail-panel");
  fireEvent.click(within(panel).getByRole("button", { name: /edit details/i }));
  return screen.findByTestId("calendar-event-editor-rail");
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

export function setCompactSchedulePickerTime(picker: HTMLElement, fieldLabel: string, { hour, minute, period }: { hour: number | string; minute: number | string; period: string }) {
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

export function createDataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: "all",
    dropEffect: "move",
    setData: vi.fn((type: string, value: string) => store.set(type, value)),
    getData: vi.fn((type: string) => store.get(type) || ""),
  };
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
