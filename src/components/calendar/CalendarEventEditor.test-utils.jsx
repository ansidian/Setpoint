import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import "./CalendarEventEditor.test-setup.js";
import CalendarModal from "./CalendarModal.jsx";

export function renderModal({
  events = [],
  focusDate = "2026-04-20",
  refreshRange = vi.fn().mockResolvedValue([]),
  upsertEvents = vi.fn(),
  removeEvent = vi.fn(),
} = {}) {
  const utils = render(
    <CalendarModal
      open
      onClose={() => {}}
      view="events"
      onViewChange={() => {}}
      focusDate={focusDate}
      eventsData={{
        editable: true,
        getEvents: () => events,
        refreshRange,
        upsertEvents,
        removeEvent,
      }}
      billsData={{}}
      deadlinesData={{}}
    />,
  );
  return { ...utils, refreshRange, upsertEvents, removeEvent };
}

export async function openFloatingEventEditorFromSelectedChip() {
  fireEvent.click(screen.getAllByTestId("calendar-cell-item-chip")[0]);
  const panel = await screen.findByTestId("calendar-floating-detail-panel");
  fireEvent.click(within(panel).getByRole("button", { name: /edit details/i }));
  return screen.findByTestId("calendar-event-editor-rail");
}

export function getActiveEventSourceTrigger() {
  return screen.getAllByTestId("calendar-event-source-trigger")
    .find((element) => !element.disabled);
}

export function getActiveEventSaveButton() {
  return screen.getAllByTestId("calendar-event-save")
    .find((element) => !element.disabled);
}

export function getActiveRepeatTrigger(labelPattern = null) {
  return screen.getAllByTestId("calendar-event-repeat-trigger")
    .filter((element) => !element.disabled)
    .filter((element) => !labelPattern || labelPattern.test(element.getAttribute("aria-label") || ""))
    .at(-1);
}

export function setCompactSchedulePickerTime(picker, fieldLabel, { hour, minute, period }) {
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

export async function typeTitle(value) {
  const input = screen.getByTestId("calendar-event-title");
  fireEvent.change(input, { target: { value } });
  await waitFor(() => {
    expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
  });
}

export function createDataTransfer() {
  const store = new Map();
  return {
    effectAllowed: "all",
    dropEffect: "move",
    setData: vi.fn((type, value) => store.set(type, value)),
    getData: vi.fn((type) => store.get(type) || ""),
  };
}

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
