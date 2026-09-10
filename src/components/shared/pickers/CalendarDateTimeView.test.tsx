import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarDateTimeView from "./CalendarDateTimeView";
import { epochFromLa } from "@/components/inbox/helpers";

afterEach(() => {
  cleanup();
});

describe("CalendarDateTimeView", () => {
  it("enforces the latest allowed day for selection and button/wheel navigation", () => {
    let selectedEpoch: number | null = null;
    render(<CalendarDateTimeView nowTick={epochFromLa(2026, 8, 9, 21, 0)}
      initialEpoch={epochFromLa(2026, 8, 9, 12, 0)} maxDate="2026-09-09"
      mode="date-only" allowPastDates submitOnDateSelect
      onSelect={epoch => { selectedEpoch = epoch; }} onBack={() => {}} />);
    const nextDay = screen.getByRole("button", { name: "20" });
    expect((nextDay as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(nextDay);
    expect(selectedEpoch).toBeNull();
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.wheel(screen.getByRole("group", { name: "Calendar month view" }), { deltaY: 100 });
    expect(screen.getByText("September 2026")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "9" })[0]!);
    expect(selectedEpoch).toBe(epochFromLa(2026, 8, 9, 12, 0));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("August 2026")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("supports keyboard AM/PM selection from a single tab stop", () => {
    let selectedEpoch: number | null = null;
    const initialEpoch = epochFromLa(2026, 3, 19, 9, 15);
    const nowTick = epochFromLa(2026, 3, 19, 9, 14);

    render(
      <CalendarDateTimeView
        nowTick={nowTick}
        initialEpoch={initialEpoch}
        onSelect={(epoch) => { selectedEpoch = epoch; }}
        onBack={() => {}}
        confirmLabel="Snooze"
      />,
    );

    const ampmGroup = screen.getByRole("group", { name: "AM or PM" });
    const amButton = screen.getByRole("button", { name: "AM" });
    const pmButton = screen.getByRole("button", { name: "PM" });
    const confirmButton = screen.getByRole("button", { name: "Snooze" });

    expect(ampmGroup.getAttribute("tabindex")).toBe("0");
    expect(amButton.getAttribute("tabindex")).toBe("-1");
    expect(pmButton.getAttribute("tabindex")).toBe("-1");

    ampmGroup.focus();
    fireEvent.keyDown(ampmGroup, { key: "p" });
    expect(document.activeElement).toBe(ampmGroup);
    expect(pmButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(confirmButton);

    expect(selectedEpoch).toBe(epochFromLa(2026, 3, 19, 21, 15));
  });

  it("supports repeated a/p toggles before enter commits", () => {
    let selectedEpoch: number | null = null;
    const initialEpoch = epochFromLa(2026, 3, 19, 9, 15);
    const nowTick = epochFromLa(2026, 3, 19, 9, 14);

    render(
      <CalendarDateTimeView
        nowTick={nowTick}
        initialEpoch={initialEpoch}
        onSelect={(epoch) => { selectedEpoch = epoch; }}
        onBack={() => {}}
        confirmLabel="Snooze"
      />,
    );

    const hourInput = screen.getByLabelText("hour");
    fireEvent.keyDown(hourInput, { key: "p" });
    fireEvent.keyDown(hourInput, { key: "a" });
    fireEvent.keyDown(hourInput, { key: "p" });
    fireEvent.keyDown(hourInput, { key: "Enter" });

    expect(selectedEpoch).toBe(epochFromLa(2026, 3, 19, 21, 15));
  });

  it("scrolls the calendar area through months with the wheel", () => {
    const onSelect = vi.fn();
    const initialEpoch = epochFromLa(2026, 3, 19, 9, 15);
    const nowTick = epochFromLa(2026, 3, 19, 9, 14);

    render(
      <CalendarDateTimeView
        nowTick={nowTick}
        initialEpoch={initialEpoch}
        onSelect={onSelect}
        onBack={() => {}}
        confirmLabel="Snooze"
      />,
    );

    const calendarView = screen.getByRole("group", { name: "Calendar month view" });
    expect(screen.getByText("April 2026")).toBeTruthy();

    fireEvent.wheel(calendarView, { deltaY: 100 });
    expect(screen.getByText("May 2026")).toBeTruthy();

    fireEvent.wheel(calendarView, { deltaY: -100 });
    expect(screen.getByText("April 2026")).toBeTruthy();
  });
});
