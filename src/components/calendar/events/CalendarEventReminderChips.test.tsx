import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ComponentProps } from "react";
import CalendarEventReminderChips from "./CalendarEventReminderChips";

afterEach(() => {
  cleanup();
});

describe("CalendarEventReminderChips", () => {
  function renderChips(props: Partial<ComponentProps<typeof CalendarEventReminderChips>> = {}) {
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
    renderChips({
      presetStates: {
        "-10": { disabled: true, reason: "duplicate" },
        "-30": { disabled: true, reason: "past" },
      },
    });

    const duplicate = screen.getByTestId("calendar-event-reminder-preset-10") as HTMLButtonElement;
    const past = screen.getByTestId("calendar-event-reminder-preset-30") as HTMLButtonElement;
    expect(duplicate.disabled).toBe(true);
    expect(duplicate.getAttribute("title")).toBe("That reminder is already on this event.");
    expect(past.disabled).toBe(true);

    fireEvent.click(duplicate);
    fireEvent.click(past);
    expect(screen.queryAllByTestId("calendar-event-reminder-chip")).toHaveLength(0);
  });

  it("offers an at-start preset for event reminders", () => {
    function ReminderHarness() {
      const [reminders, setReminders] = useState<ComponentProps<typeof CalendarEventReminderChips>["reminders"]>([]);
      return (
        <CalendarEventReminderChips
          reminders={reminders}
          reminderError={null}
          customReminder={{ date: "", time: "" }}
          disabled={false}
          presetStates={{}}
          onAddPreset={(offsetMinutes) => setReminders([{
            clientId: `preset-${offsetMinutes}`,
            offsetMinutes,
            status: "pending",
          }])}
          onUpdateCustomReminder={() => {}}
          onAddCustom={() => {}}
          onRemoveReminder={() => {}}
        />
      );
    }
    render(<ReminderHarness />);

    const atStart = screen.getByTestId("calendar-event-reminder-preset-0");
    expect(atStart.textContent).toBe("At start");

    fireEvent.click(atStart);
    expect(screen.getByTestId("calendar-event-reminder-chip").textContent).toContain("At start");
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

    expect((screen.getByTestId("reminder-custom-picker-trigger") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByLabelText("Custom reminder date")).toBeNull();
    expect(screen.queryByLabelText("Custom reminder time")).toBeNull();
  });
});
