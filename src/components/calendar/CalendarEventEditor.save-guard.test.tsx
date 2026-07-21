import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockCreateCalendarEvent } from "./CalendarEventEditor.test-setup.ts";
import { renderEventEditor, typeTitle } from "./events/CalendarEventEditor.test-utils.tsx";

// Guards P1-1: the Cmd/Ctrl+Enter save hotkey is a document-level listener that
// bypasses the Save button's disabled-while-saving state. Without a synchronous
// in-flight guard, two rapid presses each reach saveCalendarEventAction and
// persist two identical Google Calendar events.
describe("CalendarEventEditor save re-entrancy guard", () => {
  it("creates only one event when Cmd+Enter is pressed twice rapidly", async () => {
    // Keep the first create in flight so the second hotkey lands while a save
    // is still pending — the exact race the guard must close.
    let resolveCreate: ((value: unknown) => void) | undefined;
    mockCreateCalendarEvent.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    renderEventEditor();
    await screen.findByTestId("calendar-event-editor-rail");

    await typeTitle("Team lunch");
    // The first press deliberately flushes the pending title composer and
    // bounces the save. Once React applies that synchronous flush, the next two
    // presses exercise the real save re-entrancy guard without waiting on the
    // composer's 120ms wall-clock debounce.
    fireEvent.keyDown(document, { metaKey: true, key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.keyDown(document, { metaKey: true, key: "Enter" });
    fireEvent.keyDown(document, { metaKey: true, key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);

    // Release the in-flight save so no pending promise dangles past the test.
    await act(async () => {
      resolveCreate?.({ event: { id: "evt-1", etag: '"e1"' } });
      await Promise.resolve();
    });
  });
});
