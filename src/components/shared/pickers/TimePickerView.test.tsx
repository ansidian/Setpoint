import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    let bubbled = false;

    render(
      <div onKeyDown={() => { bubbled = true; }}>
        <TimePickerView
          initialTime="09:00"
          onSelect={() => {}}
          onBack={() => {}}
        />
      </div>,
    );

    fireEvent.keyDown(screen.getByLabelText("hour"), { key: "p" });

    expect(screen.getByRole("button", { name: "PM" }).getAttribute("aria-pressed")).toBe("true");
    expect(bubbled).toBe(false);
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
    let selectedTime: string | null = null;

    cleanup();
    render(
      <TimePickerView
        initialTime="15:00"
        onSelect={(time) => { selectedTime = time; }}
        onBack={() => {}}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("hour"), { key: "Enter" });

    expect(selectedTime).toBe("15:00");
  });
});
