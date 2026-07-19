import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";

vi.mock("@/components/settings/cards/EmailTriageModeCard", () => ({
  default: function EmailTriageModeCardMock() {
    return <div data-testid="email-triage-mode-card" />;
  },
}));

vi.mock("@/components/settings/cards/EmailAiModelCard", () => ({
  default: function EmailAiModelCardMock() {
    return <div data-testid="email-ai-model-card" />;
  },
}));

vi.mock("@/components/settings/cards/TriageSoundSettingsCard", () => ({
  default: function TriageSoundSettingsCardMock() {
    return <div data-testid="triage-sound-settings-card" />;
  },
}));

vi.mock("@/components/settings/cards/CoreProviderCredentialsCard", () => ({
  default: function CoreProviderCredentialsCardMock() {
    return <div data-testid="core-provider-credentials-card" />;
  },
}));

vi.mock("@/components/settings/cards/BillExtractionAiCard", () => ({
  default: function BillExtractionAiCardMock() {
    return <div data-testid="bill-extraction-card" />;
  },
}));

vi.mock("@/components/settings/cards/ImportantSendersCard", () => ({
  default: function ImportantSendersCardMock() {
    return <div data-testid="important-senders-card" />;
  },
}));

vi.mock("@/components/settings/cards/BriefingSchedulesCard", () => ({
  default: function BriefingSchedulesCardMock() {
    return <div data-testid="snapshot-boundaries-card" />;
  },
}));

const { default: EmailAutomationSettingsSection } = await import("./EmailAutomationSettingsSection");

// Stateful harness so setSettings(updater) feeds back into the section and the
// lookback/interests controls reflect the latest settings on re-render.
function Harness({ initialSettings = { email_interests: [] }, patch }: {
  initialSettings?: SettingsState;
  patch: SettingsPatch;
}) {
  const [settings, setSettings] = useState<SettingsState | null>(initialSettings);
  return (
    <EmailAutomationSettingsSection settings={settings} setSettings={setSettings} patch={patch} />
  );
}

afterEach(() => {
  cleanup();
});

describe("EmailAutomationSettingsSection", () => {
  describe("email lookback clamp", () => {
    function renderLookback() {
      const patch = vi.fn();
      render(<Harness patch={patch} />);
      const input = screen.getByDisplayValue("16");
      return { patch, input };
    }

    it("clamps a below-minimum lookback up to 1 hour", () => {
      const { patch, input } = renderLookback();

      // -5 parses truthy so it reaches Math.max's floor (a 0 would fall back to
      // the 16 default via `|| 16`, never exercising the clamp).
      fireEvent.change(input, { target: { value: "-5" } });

      expect(patch).toHaveBeenCalledWith({ email_lookback_hours: 1 });
    });

    it("clamps an above-maximum lookback down to 168 hours", () => {
      const { patch, input } = renderLookback();

      fireEvent.change(input, { target: { value: "999" } });

      expect(patch).toHaveBeenCalledWith({ email_lookback_hours: 168 });
    });

    it("passes an in-range lookback through unchanged", () => {
      const { patch, input } = renderLookback();

      fireEvent.change(input, { target: { value: "24" } });

      expect(patch).toHaveBeenCalledWith({ email_lookback_hours: 24 });
    });
  });

  describe("email interests add/remove", () => {
    it("patches email_interests_json with the appended interest on submit", () => {
      const patch = vi.fn();
      render(<Harness initialSettings={{ email_interests: ["Anthropic"] }} patch={patch} />);

      const input = screen.getByPlaceholderText("e.g. Da Vien, Anthropic, GitHub…");
      fireEvent.change(input, { target: { value: "GitHub" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(patch).toHaveBeenCalledWith({ email_interests_json: ["Anthropic", "GitHub"] });
    });

    it("does not patch when submitting a blank interest", () => {
      const patch = vi.fn();
      render(<Harness initialSettings={{ email_interests: [] }} patch={patch} />);

      const input = screen.getByPlaceholderText("e.g. Da Vien, Anthropic, GitHub…");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(patch).not.toHaveBeenCalled();
    });

    it("patches email_interests_json with the remaining interests when one is removed", () => {
      const patch = vi.fn();
      render(
        <Harness initialSettings={{ email_interests: ["Anthropic", "GitHub"] }} patch={patch} />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));

      expect(patch).toHaveBeenCalledWith({ email_interests_json: ["GitHub"] });
    });
  });
});
