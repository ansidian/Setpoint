import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarItemDetailSheet from "./CalendarItemDetailSheet.jsx";

afterEach(cleanup);

describe("CalendarItemDetailSheet (mobile bill/event sheet)", () => {
  it("renders a bill through a BottomSheet with its amount and an Open in calendar action", () => {
    const onOpenInCalendar = vi.fn();
    render(
      <CalendarItemDetailSheet
        kind="bill"
        item={{ id: "b1", name: "Rent", payee: "Landlord", amount: 1800, next_date: "2026-06-25" }}
        onClose={() => {}}
        onOpenInCalendar={onOpenInCalendar}
      />,
    );
    expect(screen.getByText("Rent")).toBeTruthy();
    expect(screen.getByText("$1,800.00")).toBeTruthy();
    expect(screen.getByText("Landlord")).toBeTruthy();
    // BottomSheet header Close affordance.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /open in calendar/i }));
    expect(onOpenInCalendar).toHaveBeenCalledTimes(1);
  });

  it("renders an event with its title and location", () => {
    render(
      <CalendarItemDetailSheet
        kind="event"
        item={{
          id: "e1",
          title: "Standup",
          startMs: new Date("2026-06-24T09:00:00-07:00").getTime(),
          endMs: new Date("2026-06-24T09:30:00-07:00").getTime(),
          location: "Zoom",
        }}
        onClose={() => {}}
        onOpenInCalendar={() => {}}
      />,
    );
    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.getByText("Zoom")).toBeTruthy();
    expect(screen.getByRole("button", { name: /open in calendar/i })).toBeTruthy();
  });

  it("renders nothing when there is no item", () => {
    const { container } = render(
      <CalendarItemDetailSheet kind="bill" item={null} onClose={() => {}} onOpenInCalendar={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });
});
