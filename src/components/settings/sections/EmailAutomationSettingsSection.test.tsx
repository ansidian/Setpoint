import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";
import type { ConnectionId, ConnectionRowView, ConnectionState } from "../connectionModel";

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
function connection(id: ConnectionId, state: ConnectionState): ConnectionRowView {
  const labels: Partial<Record<ConnectionId, string>> = {
    "google-workspace": "Google Workspace",
    "icloud-mail": "iCloud Mail",
    anthropic: "Anthropic",
    openai: "OpenAI",
  };
  return {
    id,
    group: id === "openai" || id === "anthropic" ? "ai_providers" : "data_sources",
    label: labels[id] || id,
    description: "",
    minimumViable: "",
    hash: id,
    state,
    statusLabel: state,
    source: "absent",
    mode: null,
    identities: [],
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
  };
}

const CONNECTED_DEPENDENCIES = [
  connection("google-workspace", "connected"),
  connection("icloud-mail", "not_connected"),
  connection("anthropic", "connected"),
  connection("openai", "not_connected"),
];

function Harness({ initialSettings = { email_interests: [] }, patch, connections = CONNECTED_DEPENDENCIES }: {
  initialSettings?: SettingsState;
  patch: SettingsPatch;
  connections?: ConnectionRowView[];
}) {
  const [settings, setSettings] = useState<SettingsState | null>(initialSettings);
  return (
    <EmailAutomationSettingsSection
      settings={settings}
      setSettings={setSettings}
      patch={patch}
      connections={connections}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("EmailAutomationSettingsSection", () => {
  it("shows one email-source prerequisite when Automation is unavailable", () => {
    render(
      <Harness
        patch={vi.fn()}
        connections={[
          connection("google-workspace", "not_connected"),
          connection("icloud-mail", "not_connected"),
          connection("anthropic", "not_connected"),
          connection("openai", "not_connected"),
        ]}
      />,
    );

    expect(screen.getByText("Connect an email source")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Google Workspace" }).getAttribute("href"))
      .toBe("/settings?tab=connections#google-workspace");
    expect(screen.getByRole("link", { name: "iCloud Mail" }).getAttribute("href"))
      .toBe("/settings?tab=connections#icloud-mail");
    expect(screen.queryByTestId("email-triage-mode-card")).toBeNull();
    expect(screen.queryByTestId("email-ai-model-card")).toBeNull();
  });

  it("shows email behavior plus an AI setup prompt when only email is connected", () => {
    render(
      <Harness
        patch={vi.fn()}
        connections={[
          connection("google-workspace", "connected"),
          connection("icloud-mail", "not_connected"),
          connection("anthropic", "not_connected"),
          connection("openai", "not_connected"),
        ]}
      />,
    );

    expect(screen.getByTestId("email-triage-mode-card")).toBeTruthy();
    expect(screen.getByText("Connect an AI provider")).toBeTruthy();
    expect(screen.queryByTestId("email-ai-model-card")).toBeNull();
    expect(screen.queryByTestId("bill-extraction-card")).toBeNull();
  });

  it("shows email and AI behavior when both dependency groups are connected", () => {
    render(<Harness patch={vi.fn()} />);

    expect(screen.getByTestId("email-triage-mode-card")).toBeTruthy();
    expect(screen.getByTestId("email-ai-model-card")).toBeTruthy();
    expect(screen.getByTestId("bill-extraction-card")).toBeTruthy();
    expect(screen.queryByText("Connect an AI provider")).toBeNull();
  });

  it("keeps AI controls visible with an explicit repair path when the adopted provider breaks", () => {
    render(
      <Harness
        initialSettings={{
          email_ai_provider: "openai",
          bill_extract_provider: "openai",
          email_interests: [],
        }}
        patch={vi.fn()}
        connections={[
          connection("google-workspace", "connected"),
          connection("icloud-mail", "not_connected"),
          connection("anthropic", "not_connected"),
          connection("openai", "needs_attention"),
        ]}
      />,
    );

    expect(screen.getByText("OpenAI needs attention")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Repair OpenAI" }).getAttribute("href"))
      .toBe("/settings?tab=connections#openai");
    expect(screen.getByTestId("email-ai-model-card")).toBeTruthy();
    expect(screen.getByTestId("bill-extraction-card")).toBeTruthy();
  });

  it("keeps provider credential forms out of Automation while retaining model controls", () => {
    render(<Harness patch={vi.fn()} />);

    expect(screen.queryByTestId("core-provider-credentials-card")).toBeNull();
    expect(screen.getByTestId("email-ai-model-card")).toBeTruthy();
    expect(screen.getByTestId("bill-extraction-card")).toBeTruthy();
  });

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
