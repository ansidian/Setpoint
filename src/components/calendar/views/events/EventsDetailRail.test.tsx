import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderEventsFloatingDetail } from "./EventsDetailRail.tsx";
import type { CalendarItemLike } from "../calendarViewTypes";

function event(overrides: CalendarItemLike & { id: string; title: string; start: string; end?: string }): CalendarItemLike {
  return {
    ...overrides,
    startMs: new Date(overrides.start).getTime(),
    endMs: new Date(overrides.end || overrides.start).getTime(),
    allDay: !!overrides.allDay,
  };
}

afterEach(cleanup);

// getEventSelectionId(ev) === String(ev.id); isEditableEvent === writable && eventType "default".
// The existing event() helper builds {id,title,startMs,endMs}; add writable+eventType so the
// editable gate fires and "Edit details" renders. No other fields needed.
describe("renderEventsFloatingDetail hideEdit", () => {
  const ev = event({ id: "evt1", title: "Standup", start: "2026-05-12T18:00:00Z", writable: true, eventType: "default" });

  it("shows Edit details by default", () => {
    render(renderEventsFloatingDetail({ items: [ev], selectedItemId: "evt1", onEditEvent: () => {} }));
    expect(screen.getByText("Edit details")).toBeTruthy();
  });

  it("hides Edit details when hideEdit", () => {
    render(renderEventsFloatingDetail({ items: [ev], selectedItemId: "evt1", onEditEvent: () => {}, hideEdit: true }));
    expect(screen.queryByText("Edit details")).toBeNull();
  });
});
