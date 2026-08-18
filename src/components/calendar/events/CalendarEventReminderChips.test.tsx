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

  it("shows default enablement and a grounded degraded estimate", () => {
    const { rerender } = renderChips({
      timeToLeaveEligible: true,
      onEnableTimeToLeave: () => {},
    });
    expect(screen.getByTestId("calendar-time-to-leave-enable").textContent).toContain("15 min early");

    rerender(
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
        timeToLeaveEligible
        timeToLeaveReminder={{
          id: "ttl-1",
          reminder_kind: "time_to_leave",
          remind_at: "2026-05-10T16:15:00.000Z",
          arrival_buffer_minutes: 15,
          route_duration_seconds: 1_800,
          route_status: "degraded",
        }}
      />,
    );
    expect(screen.getByText(/Leave by 9:15 AM/)).toBeTruthy();
    expect(screen.getByText(/about 30 min drive/)).toBeTruthy();
    expect(screen.getByText("Estimate needs refresh")).toBeTruthy();
    expect(screen.queryAllByTestId("calendar-event-reminder-chip")).toHaveLength(0);
  });

  it("moves the active buffer border between presets and a custom value", () => {
    function TimeToLeaveHarness() {
      const [arrivalBufferMinutes, setArrivalBufferMinutes] = useState(15);
      return (
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
          timeToLeaveEligible
          timeToLeaveReminder={{
            clientId: "ttl-draft",
            reminder_kind: "time_to_leave",
            arrival_buffer_minutes: arrivalBufferMinutes,
            status: "pending",
          }}
          onUpdateTimeToLeaveBuffer={setArrivalBufferMinutes}
        />
      );
    }
    render(<TimeToLeaveHarness />);

    const fifteenMinutes = screen.getByRole("button", { name: "15 min" });
    const thirtyMinutes = screen.getByRole("button", { name: "30 min" });
    const custom = screen.getByLabelText("Custom arrival buffer minutes") as HTMLInputElement;
    expect(fifteenMinutes.getAttribute("aria-pressed")).toBe("true");
    expect(thirtyMinutes.getAttribute("aria-pressed")).toBe("false");
    expect(custom.dataset.selected).toBe("false");

    fireEvent.click(thirtyMinutes);
    expect(fifteenMinutes.getAttribute("aria-pressed")).toBe("false");
    expect(thirtyMinutes.getAttribute("aria-pressed")).toBe("true");
    expect(custom.dataset.selected).toBe("false");

    fireEvent.change(custom, { target: { value: "45" } });
    expect(thirtyMinutes.getAttribute("aria-pressed")).toBe("false");
    expect(custom.dataset.selected).toBe("true");

    fireEvent.click(thirtyMinutes);
    expect(thirtyMinutes.getAttribute("aria-pressed")).toBe("true");
    expect(custom.dataset.selected).toBe("false");
  });
});
