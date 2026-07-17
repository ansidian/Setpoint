import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TodoistReminderChips from "./TodoistReminderChips";

afterEach(() => {
  cleanup();
});

describe("TodoistReminderChips", () => {
  function renderChips(props = {}) {
    return render(
      <TodoistReminderChips
        reminders={[]}
        reminderError={null}
        customReminder={{ date: "", time: "" }}
        disabled={false}
        hasAnchor
        presetStates={{}}
        onAddPreset={() => {}}
        onUpdateCustomReminder={() => {}}
        onAddCustom={() => {}}
        onRemoveReminder={() => {}}
        {...props}
      />,
    );
  }

  it("disables duplicate and past Todoist reminder presets before click", () => {
    const onAddPreset = vi.fn();
    renderChips({
      presetStates: {
        "-10": { disabled: true, reason: "duplicate" },
        "-30": { disabled: true, reason: "past" },
      },
      onAddPreset,
    });

    const duplicate = screen.getByTestId("todoist-reminder-preset-10");
    const past = screen.getByTestId("todoist-reminder-preset-30");
    expect((duplicate as HTMLButtonElement).disabled).toBe(true);
    expect(duplicate.getAttribute("title")).toBe("That reminder is already on this task.");
    expect((past as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(duplicate);
    fireEvent.click(past);
    expect(onAddPreset).not.toHaveBeenCalled();
  });

  it("identifies reminders as Discord webhooks separate from Todoist", () => {
    renderChips();

    expect(screen.getByRole("region", { name: "Discord webhook reminders" })).toBeTruthy();
    expect(screen.getByText("Discord webhook reminders")).toBeTruthy();
    expect(screen.getByText("Separate from the Todoist deadline and notifications.")).toBeTruthy();
  });

  it("keeps custom reminder creation available for anchored past tasks", () => {
    renderChips({
      presetStates: {
        "-10": { disabled: true, reason: "past" },
        "-30": { disabled: true, reason: "past" },
        "-60": { disabled: true, reason: "past" },
        "-1440": { disabled: true, reason: "past" },
      },
    });

    expect((screen.getByTestId("reminder-custom-picker-trigger") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByLabelText("Custom Todoist reminder date")).toBeNull();
    expect(screen.queryByLabelText("Custom Todoist reminder time")).toBeNull();
  });
});
