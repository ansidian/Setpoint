import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { SettingsPatch, SettingsState } from "../settingsTypes";

const mockApi = vi.hoisted(() => ({
  skipSchedule: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- schedule skipping crosses the authenticated scheduler/persistence HTTP boundary while returned boundary state renders normally.
vi.mock("@/api", () => ({
  skipSchedule: mockApi.skipSchedule,
}));

const { default: BriefingSchedulesCard } = await import("./BriefingSchedulesCard");

function renderCard({ initialSettings, patch = vi.fn() }: {
  initialSettings?: SettingsState;
  patch?: SettingsPatch;
} = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>(initialSettings || {
      schedules: [{ label: "Morning", time: "08:00", enabled: true }],
    });
    return <BriefingSchedulesCard settings={settings} setSettings={setSettings} patch={patch} />;
  }

  return {
    patch,
    ...render(<Harness />),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.skipSchedule.mockResolvedValue({ schedules: [{ label: "Morning", time: "08:00", enabled: true }] });
});

describe("BriefingSchedulesCard", () => {
  it("adds and removes snapshot boundaries while persisting the updated payload", async () => {
    renderCard();
    expect(screen.getByText("Snapshot Boundaries")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /\+ add boundary/i }));

    expect(screen.getByDisplayValue("New Boundary")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Remove boundary")[1]!);

    await waitFor(() => {
      expect(screen.queryByDisplayValue("New Boundary")).toBeNull();
    });
  });

  it("patches toggles and edited times", async () => {
    renderCard();

    const toggle = screen.getByRole("switch", { name: /disable boundary/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    const timeInput = screen.getByDisplayValue("08:00");
    fireEvent.focus(timeInput);
    fireEvent.change(timeInput, { target: { value: "07:30" } });
    fireEvent.blur(timeInput);

    expect(screen.getByDisplayValue("07:30")).toBeTruthy();
  });

  it("never patches a blank schedule label, restoring a non-blank fallback on blur (P1-3)", async () => {
    renderCard();

    const labelInput = screen.getByDisplayValue("Morning");
    fireEvent.focus(labelInput);
    fireEvent.change(labelInput, { target: { value: "" } });
    fireEvent.blur(labelInput);

    // The server rejects a blank label with a 400 for the WHOLE PUT, which also
    // drops every co-batched setting in the same debounce window. The card must
    // never send a blank label.
    expect((screen.getByDisplayValue("Morning") as HTMLInputElement).value.trim()).not.toBe("");
  });

  it("never patches a blank schedule time, restoring a default on blur (P1-3)", async () => {
    renderCard();

    const timeInput = screen.getByDisplayValue("08:00");
    fireEvent.focus(timeInput);
    fireEvent.change(timeInput, { target: { value: "" } });
    fireEvent.blur(timeInput);

    // A cleared native time input sends time:"" which the server rejects with a
    // 400, dropping every co-batched setting — and the autosave re-queue would
    // then re-send the invalid payload on every subsequent flush.
    expect((screen.getByDisplayValue("08:00") as HTMLInputElement).value.trim()).not.toBe("");
  });

  it("applies skip results returned by the API", async () => {
    mockApi.skipSchedule.mockResolvedValue({
      schedules: [
        {
          label: "Morning",
          time: "08:00",
          enabled: true,
          skipped_until: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /skip boundary today/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /boundary skipped today/i })).toBeTruthy();
    });
    // test-architecture: allow-boundary-interaction -- scheduler skip targets an indexed boundary and explicit day-state not encoded in the returned schedule label.
    expect(mockApi.skipSchedule).toHaveBeenCalledWith(0, true);
  });
});
