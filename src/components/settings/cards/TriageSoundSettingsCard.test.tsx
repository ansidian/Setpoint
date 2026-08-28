import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { playTriageNotificationSound } from "@/lib/triageSoundPlayback";

// test-architecture: allow-boundary-mock -- Web Audio playback cannot execute in happy-dom; the real card selects the sound and browser volume before this boundary.
vi.mock("@/lib/triageSoundPlayback", () => ({
  playTriageNotificationSound: vi.fn(),
}));

import TriageSoundSettingsCard from "./TriageSoundSettingsCard";
import type { SettingsState } from "../settingsTypes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function renderCard(initialSettings: SettingsState = {}) {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>({
      triage_sound_settings: {
        laneScope: "needs_attention_and_fyi",
        volume: 0.8,
        triggers: {
          needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
          email_queued: { enabled: true, soundId: "quick_chime" },
          fyi_finalized: { enabled: true, soundId: "smooth_modern" },
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
    return (
      <TriageSoundSettingsCard
        settings={settings}
        setSettings={setSettings}
        patch={() => {}}
      />
    );
  }
  render(<Harness />);
}

describe("TriageSoundSettingsCard", () => {

  it("patches the toggled trigger when its checkbox is flipped", () => {
    renderCard();

    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: /fyi finalized/i });
    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(false);
  });

  it("invokes playback for the selected row sound from the Test control", () => {
    vi.mocked(playTriageNotificationSound).mockClear();
    renderCard();

    fireEvent.click(screen.getAllByRole("button", { name: /test/i })[0]!);

    // test-architecture: allow-boundary-interaction -- the chosen asset and gain options cross the Web Audio boundary and are not recoverable from the generic unlock message.
    expect(playTriageNotificationSound).toHaveBeenCalledWith(
      expect.objectContaining({ id: "clear_chime", path: "/sounds/notifications/clear-chime.mp3" }),
      expect.objectContaining({ markUnlocked: true, volume: 0.8 }),
    );
  });

  it("patches the volume setting", () => {
    renderCard();

    fireEvent.change(screen.getByRole("slider", { name: /notification sound volume/i }), {
      target: { value: "0.55" },
    });

    expect(screen.getByText("55%")).toBeTruthy();
  });
});
