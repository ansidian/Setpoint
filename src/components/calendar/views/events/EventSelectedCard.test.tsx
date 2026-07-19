import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventSelectedCard from "./EventSelectedCard.tsx";

afterEach(cleanup);

function event(overrides = {}) {
  return {
    id: "e1",
    title: "Standup",
    startMs: new Date("2026-07-15T17:00:00Z").getTime(),
    endMs: new Date("2026-07-15T17:30:00Z").getTime(),
    allDay: false,
    writable: true,
    eventType: "default",
    ...overrides,
  };
}

describe("EventSelectedCard", () => {
  it("renders a sanitized title, a time, and an attendee accessory", () => {
    render(<EventSelectedCard ev={event({ title: "Zoom: Standup", attendees: ["a@x.com", "b@x.com"] })} />);
    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.getByTestId("calendar-selected-event-time").textContent).toBeTruthy();
    expect(screen.getByText("2 attendees")).toBeTruthy();
  });

});
