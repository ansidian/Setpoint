import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIAGE_SOUND_AUDIO_UNLOCK_KEY } from "@/lib/triageSoundPlayback";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");

  function Select({ value, onValueChange, children }) {
    const childList = React.Children.toArray(children);
    const trigger = childList.find(
      (child) => React.isValidElement(child) && child.type?.displayName === "MockSelectTrigger",
    );
    const content = childList.find(
      (child) => React.isValidElement(child) && child.type?.displayName === "MockSelectContent",
    );
    const items = React.Children.toArray(content?.props?.children).filter(React.isValidElement);

    return (
      <select
        aria-label={trigger?.props?.["aria-label"]}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {items.map((item) => (
          <option key={item.props.value} value={item.props.value}>
            {item.props.children}
          </option>
        ))}
      </select>
    );
  }

  function SelectTrigger() {
    return null;
  }
  SelectTrigger.displayName = "MockSelectTrigger";

  function SelectValue() {
    return null;
  }

  function SelectContent() {
    return null;
  }
  SelectContent.displayName = "MockSelectContent";

  function SelectItem() {
    return null;
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

import TriageSoundSettingsCard from "./TriageSoundSettingsCard.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function renderCard(initialSettings = {}) {
  const patch = vi.fn();
  const setSettingsSpy = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState({
      triage_sound_settings: {
        laneScope: "needs_attention_and_fyi",
        volume: 0.8,
        triggers: {
          needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
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
        { id: "hard_pop_click", label: "Hard Pop Click", path: "/sounds/notifications/hard-pop-click.wav" },
        { id: "low_tone", label: "Low tone", path: "/sounds/notifications/low-tone.mp3" },
      ],
      ...initialSettings,
    });
    const setSettingsWithSpy = (updater) => {
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
    expect(screen.getByText("FYI finalized")).toBeTruthy();
    expect(screen.getByText("Weak-security grace")).toBeTruthy();
    expect(screen.getByText("Triage failed")).toBeTruthy();
    expect(screen.getByText("Upcoming event")).toBeTruthy();
    expect(screen.getByText("Task completed")).toBeTruthy();
    expect(screen.getByRole("slider", { name: /notification sound volume/i }).value).toBe("0.8");
    expect(screen.getByRole("checkbox", { name: /triage failed/i }).checked).toBe(false);
  });

  it("patches the full triage sound settings object when a trigger is toggled", () => {
    const { patch, setSettings } = renderCard();

    fireEvent.click(screen.getByRole("checkbox", { name: /fyi finalized/i }));

    expect(setSettings).toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({
      triage_sound_settings: {
        laneScope: "needs_attention_and_fyi",
        volume: 0.8,
        triggers: {
          needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
          fyi_finalized: { enabled: false, soundId: "smooth_modern" },
          weak_security_grace: { enabled: true, soundId: "low_tone" },
          triage_failed: { enabled: false, soundId: "low_tone" },
          event_upcoming: { enabled: true, soundId: "clear_chime" },
          task_completed: { enabled: true, soundId: "smooth_modern" },
        },
      },
    });
  });

  it("plays the selected row sound from the Test control and marks audio ready", async () => {
    const play = vi.fn(() => Promise.resolve());
    const AudioMock = vi.fn(function AudioMock(path) {
      this.path = path;
      this.play = play;
    });
    vi.stubGlobal("Audio", AudioMock);
    renderCard();

    fireEvent.click(screen.getAllByRole("button", { name: /test/i })[0]);

    expect(AudioMock).toHaveBeenCalledWith("/sounds/notifications/clear-chime.mp3");
    expect(play).toHaveBeenCalled();
    expect(AudioMock.mock.instances[0].volume).toBe(0.8);
    await waitFor(() => {
      expect(sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY)).toBe("1");
    });
    expect(screen.getByText("Test playback unlocks audio for this browser session when the browser allows it.")).toBeTruthy();
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
