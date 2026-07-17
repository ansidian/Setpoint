import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomDateTimeView } from "./SnoozePicker";
import { epochFromLa } from "./helpers";

afterEach(() => {
  cleanup();
});

describe("CustomDateTimeView", () => {
  it("supports keyboard AM/PM selection from a single tab stop", () => {
    const onSelect = vi.fn();
    const initialEpoch = epochFromLa(2026, 3, 19, 9, 15);
    const nowTick = epochFromLa(2026, 3, 19, 9, 14);

    render(
      <CustomDateTimeView
        nowTick={nowTick}
        initialEpoch={initialEpoch}
        onSelect={onSelect}
        onBack={() => {}}
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

    expect(onSelect).toHaveBeenCalledWith(epochFromLa(2026, 3, 19, 21, 15));
  });

  it("supports repeated a/p toggles before enter commits", () => {
    const onSelect = vi.fn();
    const initialEpoch = epochFromLa(2026, 3, 19, 9, 15);
    const nowTick = epochFromLa(2026, 3, 19, 9, 14);

    render(
      <CustomDateTimeView
        nowTick={nowTick}
        initialEpoch={initialEpoch}
        onSelect={onSelect}
        onBack={() => {}}
      />,
    );

    const hourInput = screen.getByLabelText("hour");
    fireEvent.keyDown(hourInput, { key: "p" });
    fireEvent.keyDown(hourInput, { key: "a" });
    fireEvent.keyDown(hourInput, { key: "p" });
    fireEvent.keyDown(hourInput, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(epochFromLa(2026, 3, 19, 21, 15));
  });

  it("scrolls the calendar area through months with the wheel", () => {
    const onSelect = vi.fn();
    const initialEpoch = epochFromLa(2026, 3, 19, 9, 15);
    const nowTick = epochFromLa(2026, 3, 19, 9, 14);

    render(
      <CustomDateTimeView
        nowTick={nowTick}
        initialEpoch={initialEpoch}
        onSelect={onSelect}
        onBack={() => {}}
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
