import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmailTriageModeCard from "./EmailTriageModeCard.jsx";

afterEach(() => {
  cleanup();
});

function renderCard(initialSettings = {}) {
  const patch = vi.fn();
  const setSettingsSpy = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState({
      email_triage_mode: "auto",
      email_triage_effective_mode: "no_model",
      ...initialSettings,
    });
    const setSettingsWithSpy = (updater) => {
      setSettingsSpy(updater);
      setSettings(updater);
    };
    return (
      <EmailTriageModeCard
        settings={settings}
        setSettings={setSettingsWithSpy}
        patch={patch}
      />
    );
  }
  render(
    <Harness />,
  );
  return { patch, setSettings: setSettingsSpy };
}

describe("EmailTriageModeCard", () => {
  it("shows stored and effective email triage modes distinctly", () => {
    renderCard({ email_triage_mode: "auto", email_triage_effective_mode: "no_model" });

    expect(screen.getByText("Email Triage Automation")).toBeTruthy();
    expect(screen.getByText("Stored: Auto")).toBeTruthy();
    expect(screen.getByText("Effective: No model")).toBeTruthy();
  });

  it("patches the selected mode", () => {
    const { patch, setSettings } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /pause/i }));

    expect(setSettings).toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({ email_triage_mode: "paused" });
  });

  it("updates the effective chip immediately for explicit modes", () => {
    renderCard({
      email_triage_mode: "auto",
      email_triage_effective_mode: "no_model",
    });

    fireEvent.click(screen.getByRole("button", { name: /use real/i }));

    expect(screen.getByText("Stored: Real")).toBeTruthy();
    expect(screen.getByText("Effective: Real")).toBeTruthy();
  });

  it("re-resolves auto immediately after an explicit mode was selected", () => {
    renderCard({
      email_triage_mode: "auto",
      email_triage_effective_mode: "no_model",
    });

    fireEvent.click(screen.getByRole("button", { name: /use real/i }));
    expect(screen.getByText("Effective: Real")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^auto$/i }));

    expect(screen.getByText("Stored: Auto")).toBeTruthy();
    expect(screen.getByText("Effective: No model")).toBeTruthy();
  });
});
