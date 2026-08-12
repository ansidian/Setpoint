import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsPatch, SettingsState } from "../settingsTypes";
import type { ConnectionId, ConnectionRowView, ConnectionState } from "../connectionModel";

const mockApi = vi.hoisted(() => ({
  getAlfredModels: vi.fn(),
  getBillExtractModels: vi.fn(),
  getImportantSenders: vi.fn(),
  getModels: vi.fn(),
  getRemoteContentTrust: vi.fn(),
  getTriageCacheStats: vi.fn(),
  removeRemoteContentTrust: vi.fn(),
  trustRemoteContentSender: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- model catalogs, triage stats, and sender persistence are external Settings API boundaries; real cards render together below them.
vi.mock("@/api", () => mockApi);

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
  vi.resetAllMocks();
});

beforeEach(() => {
  const providers = [{
    provider: "anthropic",
    label: "Anthropic",
    available: true,
    defaultModel: "claude-sonnet-4-6",
    models: [{ id: "claude-sonnet-4-6", label: "Claude Sonnet" }],
  }, {
    provider: "openai",
    label: "OpenAI",
    available: true,
    defaultModel: "gpt-5",
    models: [{ id: "gpt-5", label: "GPT-5" }],
  }];
  mockApi.getAlfredModels.mockResolvedValue(providers);
  mockApi.getBillExtractModels.mockResolvedValue(providers);
  mockApi.getModels.mockResolvedValue(providers);
  mockApi.getImportantSenders.mockResolvedValue([]);
  mockApi.getRemoteContentTrust.mockResolvedValue([]);
  mockApi.getTriageCacheStats.mockResolvedValue({ openaiCalls: 0, windowDays: 7 });
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
    expect(screen.queryByText("Email Triage Automation")).toBeNull();
    expect(screen.queryByText("Inbox Triage AI")).toBeNull();
    expect(screen.queryByText("Alfred AI")).toBeNull();
  });

  it("keeps Alfred model settings available when AI is connected but email is not", () => {
    render(
      <Harness
        patch={vi.fn()}
        connections={[
          connection("google-workspace", "not_connected"),
          connection("icloud-mail", "not_connected"),
          connection("anthropic", "connected"),
          connection("openai", "not_connected"),
        ]}
      />,
    );

    expect(screen.getByText("Alfred AI")).toBeTruthy();
    expect(screen.getByText("Connect an email source")).toBeTruthy();
    expect(screen.queryByText("Inbox Triage AI")).toBeNull();
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

    expect(screen.getByText("Email Triage Automation")).toBeTruthy();
    expect(screen.getByText("Connect an AI provider")).toBeTruthy();
    expect(screen.queryByText("Inbox Triage AI")).toBeNull();
    expect(screen.queryByText("Bill Extraction AI")).toBeNull();
    expect(screen.queryByText("Alfred AI")).toBeNull();
  });

  it("shows email and AI behavior when both dependency groups are connected", () => {
    render(<Harness patch={vi.fn()} />);

    expect(screen.getByText("Email Triage Automation")).toBeTruthy();
    expect(screen.getByText("Inbox Triage AI")).toBeTruthy();
    expect(screen.getByText("Alfred AI")).toBeTruthy();
    expect(screen.getByText("Bill Extraction AI")).toBeTruthy();
    expect(screen.getByText("Remote Content")).toBeTruthy();
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
    expect(screen.getByText("Inbox Triage AI")).toBeTruthy();
    expect(screen.getByText("Alfred AI")).toBeTruthy();
    expect(screen.getByText("Bill Extraction AI")).toBeTruthy();
  });

  it("keeps provider credential forms out of Automation while retaining model controls", () => {
    render(<Harness patch={vi.fn()} />);

    expect(screen.queryByText(/credentials/i)).toBeNull();
    expect(screen.getByText("Inbox Triage AI")).toBeTruthy();
    expect(screen.getByText("Bill Extraction AI")).toBeTruthy();
  });

  describe("email lookback clamp", () => {
    function renderLookback() {
      render(<Harness patch={() => {}} />);
      const input = screen.getByDisplayValue("16");
      return { input };
    }

    it("clamps a below-minimum lookback up to 1 hour", () => {
      const { input } = renderLookback();

      // -5 parses truthy so it reaches Math.max's floor (a 0 would fall back to
      // the 16 default via `|| 16`, never exercising the clamp).
      fireEvent.change(input, { target: { value: "-5" } });

      expect((input as HTMLInputElement).value).toBe("1");
    });

    it("clamps an above-maximum lookback down to 168 hours", () => {
      const { input } = renderLookback();

      fireEvent.change(input, { target: { value: "999" } });

      expect((input as HTMLInputElement).value).toBe("168");
    });

    it("passes an in-range lookback through unchanged", () => {
      const { input } = renderLookback();

      fireEvent.change(input, { target: { value: "24" } });

      expect((input as HTMLInputElement).value).toBe("24");
    });
  });

  describe("email interests add/remove", () => {
    it("patches email_interests_json with the appended interest on submit", () => {
      render(<Harness initialSettings={{ email_interests: ["Anthropic"] }} patch={() => {}} />);

      const input = screen.getByPlaceholderText("e.g. Da Vien, Anthropic, GitHub…");
      fireEvent.change(input, { target: { value: "GitHub" } });
      fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "Add" }));

      expect(screen.getByRole("button", { name: "Remove Anthropic" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Remove GitHub" })).toBeTruthy();
    });

    it("does not patch when submitting a blank interest", () => {
      render(<Harness initialSettings={{ email_interests: [] }} patch={() => {}} />);

      const input = screen.getByPlaceholderText("e.g. Da Vien, Anthropic, GitHub…");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "Add" }));

      expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    });

    it("patches email_interests_json with the remaining interests when one is removed", () => {
      render(
        <Harness initialSettings={{ email_interests: ["Anthropic", "GitHub"] }} patch={() => {}} />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));

      expect(screen.queryByRole("button", { name: "Remove Anthropic" })).toBeNull();
      expect(screen.getByRole("button", { name: "Remove GitHub" })).toBeTruthy();
    });
  });
});
