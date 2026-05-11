import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarEventReminderChips from "./CalendarEventReminderChips.jsx";

afterEach(() => {
  cleanup();
});

describe("CalendarEventReminderChips", () => {
  function renderChips(props = {}) {
    return render(
      <CalendarEventReminderChips
        reminders={[]}
        reminderError={null}
        customReminder={{ date: "", time: "" }}
        disabled={false}
        presetStates={{}}
        onAddPreset={() => {}}
        onUpdateCustomReminder={() => {}}
        onAddCustom={() => {}}
        onRemoveReminder={() => {}}
        {...props}
      />,
    );
  }

  it("disables duplicate and past reminder presets before click", () => {
    const onAddPreset = vi.fn();
    renderChips({
      presetStates: {
        "-10": { disabled: true, reason: "duplicate" },
        "-30": { disabled: true, reason: "past" },
      },
      onAddPreset,
    });

    const duplicate = screen.getByTestId("calendar-event-reminder-preset-10");
    const past = screen.getByTestId("calendar-event-reminder-preset-30");
    expect(duplicate.disabled).toBe(true);
    expect(duplicate.getAttribute("title")).toBe("That reminder is already on this event.");
    expect(past.disabled).toBe(true);

    fireEvent.click(duplicate);
    fireEvent.click(past);
    expect(onAddPreset).not.toHaveBeenCalled();
  });

  it("offers an at-start preset for event reminders", () => {
    const onAddPreset = vi.fn();
    renderChips({ onAddPreset });

    const atStart = screen.getByTestId("calendar-event-reminder-preset-0");
    expect(atStart.textContent).toBe("At start");

    fireEvent.click(atStart);
    expect(onAddPreset).toHaveBeenCalledWith(0);
  });

  it("keeps custom reminder creation available when presets are disabled", () => {
    renderChips({
      presetStates: {
        "-10": { disabled: true, reason: "past" },
        "-30": { disabled: true, reason: "past" },
        "-60": { disabled: true, reason: "past" },
        "-1440": { disabled: true, reason: "past" },
      },
    });

    expect(screen.getByTestId("reminder-custom-picker-trigger").disabled).toBe(false);
    expect(screen.queryByLabelText("Custom reminder date")).toBeNull();
    expect(screen.queryByLabelText("Custom reminder time")).toBeNull();
  });
});
