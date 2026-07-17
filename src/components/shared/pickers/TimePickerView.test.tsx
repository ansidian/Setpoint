import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TimePickerView from "./TimePickerView";

afterEach(() => {
  cleanup();
});

describe("TimePickerView", () => {
  it("auto-focuses the hour field when the picker opens", () => {
    render(
      <TimePickerView
        initialTime="09:00"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByLabelText("hour")).toBe(document.activeElement);
  });

  it("switches to PM with the p hotkey and keeps the event from bubbling", () => {
    const onKeyDown = vi.fn();

    render(
      <div onKeyDown={onKeyDown}>
        <TimePickerView
          initialTime="09:00"
          onSelect={() => {}}
          onBack={() => {}}
        />
      </div>,
    );

    fireEvent.keyDown(screen.getByLabelText("hour"), { key: "p" });

    expect(screen.getByRole("button", { name: "PM" }).getAttribute("aria-pressed")).toBe("true");
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("switches to AM with the a hotkey from the minute field", () => {
    cleanup();
    render(
      <TimePickerView
        initialTime="15:00"
        onSelect={() => {}}
        onBack={() => {}}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("minute"), { key: "a" });

    expect(screen.getByRole("button", { name: "AM" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("submits the current time when enter is pressed from a number field", () => {
    const onSelect = vi.fn();

    cleanup();
    render(
      <TimePickerView
        initialTime="15:00"
        onSelect={onSelect}
        onBack={() => {}}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("hour"), { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("15:00");
  });
});
