import { useState } from "react";
import type { SetStateAction } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { playTriageNotificationSound } from "@/lib/triageSoundPlayback";

vi.mock("@/lib/triageSoundPlayback", () => ({
  playTriageNotificationSound: vi.fn(),
}));

vi.mock("@/components/ui/select", () => import("../shared/selectMock.test-utils"));

import TriageSoundSettingsCard from "./TriageSoundSettingsCard";
import type { SettingsState } from "../settingsTypes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function renderCard(initialSettings: SettingsState = {}) {
  const patch = vi.fn();
  const setSettingsSpy = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>({
      triage_sound_settings: {
        laneScope: "needs_attention_and_fyi",
        volume: 0.8,
        triggers: {
          needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
          email_queued: { enabled: true, soundId: "quick_chime" },
          fyi_finalized: { enabled: true, soundId: "smooth_modern" },
          weak_security_grace: { enabled: true, soundId: "low_tone" },
          triage_failed: { enabled: false, soundId: "low_tone" },
          event_upcoming: { enabled: true, soundId: "clear_chime" },
          task_completed: { enabled: true, soundId: "smooth_modern" },
        },
      },
      triage_notification_sounds: [
        { id: "smooth_modern", label: "Smooth Modern", path: "/sounds/notifications/smooth-modern.mp3" },
        { id: "clear_chime", label: "Clear chime", path: "/sounds/notifications/clear-chime.mp3" },
        { id: "quick_chime", label: "Quick chime", path: "/sounds/notifications/quick-chime.mp3" },
        { id: "hard_pop_click", label: "Hard Pop Click", path: "/sounds/notifications/hard-pop-click.wav" },
        { id: "low_tone", label: "Low tone", path: "/sounds/notifications/low-tone.mp3" },
      ],
      ...initialSettings,
    });
    const setSettingsWithSpy = (updater: SetStateAction<SettingsState | null>) => {
      setSettingsSpy(updater);
      setSettings(updater);
    };
    return (
      <TriageSoundSettingsCard
        settings={settings}
        setSettings={setSettingsWithSpy}
        patch={patch}
      />
    );
  }
  render(<Harness />);
  return { patch, setSettings: setSettingsSpy };
}

describe("TriageSoundSettingsCard", () => {
  it("renders all trigger rows with their default enabled state", () => {
    renderCard();

    expect(screen.getByText("Triage Notification Sounds")).toBeTruthy();
    expect(screen.getByText("Needs attention finalized")).toBeTruthy();
    expect(screen.getByText("Queued mail")).toBeTruthy();
    expect(screen.getByText("FYI finalized")).toBeTruthy();
    expect(screen.getByText("Weak-security grace")).toBeTruthy();
    expect(screen.getByText("Triage failed")).toBeTruthy();
    expect(screen.getByText("Upcoming event")).toBeTruthy();
    expect(screen.getByText("Task completed")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("slider", { name: /notification sound volume/i }).value).toBe("0.8");
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /triage failed/i }).checked).toBe(false);
  });

  it("patches the toggled trigger when its checkbox is flipped", () => {
    const { patch, setSettings } = renderCard();

    fireEvent.click(screen.getByRole("checkbox", { name: /fyi finalized/i }));

    expect(setSettings).toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({
      triage_sound_settings: expect.objectContaining({
        triggers: expect.objectContaining({
          fyi_finalized: { enabled: false, soundId: "smooth_modern" },
        }),
      }),
    });
  });

  it("invokes playback for the selected row sound from the Test control", () => {
    vi.mocked(playTriageNotificationSound).mockClear();
    renderCard();

    fireEvent.click(screen.getAllByRole("button", { name: /test/i })[0]!);

    expect(playTriageNotificationSound).toHaveBeenCalledWith(
      expect.objectContaining({ id: "clear_chime", path: "/sounds/notifications/clear-chime.mp3" }),
      expect.objectContaining({ markUnlocked: true, volume: 0.8 }),
    );
  });

  it("patches the full triage sound settings object when a trigger sound changes", () => {
    const { patch } = renderCard();

    fireEvent.change(screen.getByRole("combobox", { name: /fyi finalized sound/i }), {
      target: { value: "hard_pop_click" },
    });

    expect(patch).toHaveBeenCalledWith({
      triage_sound_settings: expect.objectContaining({
        triggers: expect.objectContaining({
          fyi_finalized: { enabled: true, soundId: "hard_pop_click" },
          email_queued: { enabled: true, soundId: "quick_chime" },
          task_completed: { enabled: true, soundId: "smooth_modern" },
        }),
      }),
    });
  });

  it("patches the volume setting", () => {
    const { patch } = renderCard();

    fireEvent.change(screen.getByRole("slider", { name: /notification sound volume/i }), {
      target: { value: "0.55" },
    });

    expect(patch).toHaveBeenCalledWith({
      triage_sound_settings: expect.objectContaining({
        volume: 0.55,
      }),
    });
  });
});
