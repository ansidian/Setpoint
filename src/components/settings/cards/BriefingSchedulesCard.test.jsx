import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

const mockApi = vi.hoisted(() => ({
  skipSchedule: vi.fn(),
}));

vi.mock("@/api", () => ({
  skipSchedule: mockApi.skipSchedule,
}));

const { default: BriefingSchedulesCard } = await import("./BriefingSchedulesCard.jsx");

function renderCard({ initialSettings, patch = vi.fn() } = {}) {
  function Harness() {
    const [settings, setSettings] = useState(initialSettings || {
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
  it("presents schedules as snapshot boundaries instead of a generator", () => {
    renderCard();

    expect(screen.getByText("Snapshot Boundaries")).toBeTruthy();
    expect(screen.getByText("Schedule times for rolling the active email snapshot window.")).toBeTruthy();
    expect(screen.queryByText(/generation/i)).toBeNull();
  });

  it("adds and removes snapshot boundaries while persisting the updated payload", async () => {
    const patch = vi.fn();
    renderCard({ patch });

    fireEvent.click(screen.getByRole("button", { name: /\+ add boundary/i }));

    expect(screen.getByDisplayValue("New Boundary")).toBeTruthy();
    expect(patch).toHaveBeenLastCalledWith({
      schedules_json: [
        { label: "Morning", time: "08:00", enabled: true },
        { label: "New Boundary", time: "08:00", enabled: false },
      ],
    });

    fireEvent.click(screen.getAllByLabelText("Remove boundary")[1]);

    await waitFor(() => {
      expect(screen.queryByDisplayValue("New Boundary")).toBeNull();
    });
    expect(patch).toHaveBeenLastCalledWith({
      schedules_json: [{ label: "Morning", time: "08:00", enabled: true }],
    });
  });

  it("patches toggles and edited times", async () => {
    const patch = vi.fn();
    renderCard({ patch });

    fireEvent.click(screen.getByRole("switch", { name: /disable boundary/i }));
    expect(patch).toHaveBeenLastCalledWith({
      schedules_json: [{ label: "Morning", time: "08:00", enabled: false }],
    });

    const timeInput = screen.getByDisplayValue("08:00");
    fireEvent.focus(timeInput);
    fireEvent.change(timeInput, { target: { value: "07:30" } });
    fireEvent.blur(timeInput);

    await waitFor(() => {
      expect(patch).toHaveBeenLastCalledWith({
        schedules_json: [{ label: "Morning", time: "07:30", enabled: false }],
      });
    });
  });

  it("never patches a blank schedule label, restoring a non-blank fallback on blur (P1-3)", async () => {
    const patch = vi.fn();
    renderCard({ patch });

    const labelInput = screen.getByDisplayValue("Morning");
    fireEvent.focus(labelInput);
    fireEvent.change(labelInput, { target: { value: "" } });
    fireEvent.blur(labelInput);

    // The server rejects a blank label with a 400 for the WHOLE PUT, which also
    // drops every co-batched setting in the same debounce window. The card must
    // never send a blank label.
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const lastPayload = patch.mock.calls.at(-1)[0];
    expect(lastPayload.schedules_json[0].label.trim()).not.toBe("");
  });

  it("never patches a blank schedule time, restoring a default on blur (P1-3)", async () => {
    const patch = vi.fn();
    renderCard({ patch });

    const timeInput = screen.getByDisplayValue("08:00");
    fireEvent.focus(timeInput);
    fireEvent.change(timeInput, { target: { value: "" } });
    fireEvent.blur(timeInput);

    // A cleared native time input sends time:"" which the server rejects with a
    // 400, dropping every co-batched setting — and the autosave re-queue would
    // then re-send the invalid payload on every subsequent flush.
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const lastPayload = patch.mock.calls.at(-1)[0];
    expect(lastPayload.schedules_json[0].time.trim()).not.toBe("");
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
    expect(mockApi.skipSchedule).toHaveBeenCalledWith(0, true);
  });
});
