import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  soundSettingsPayload: {
    laneScope: "needs_attention_and_fyi",
    volume: 1,
    triggers: {
      needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
      fyi_finalized: { enabled: true, soundId: "smooth_modern" },
      weak_security_grace: { enabled: true, soundId: "low_tone" },
      triage_failed: { enabled: false, soundId: "low_tone" },
      event_upcoming: { enabled: true, soundId: "clear_chime" },
      task_completed: { enabled: true, soundId: "smooth_modern" },
    },
  },
}));

vi.mock("@/api", () => ({
  getAccounts: mockApi.getAccounts,
  getSettings: mockApi.getSettings,
  updateSettings: mockApi.updateSettings,
}));

vi.mock("@/components/settings/sections/AccountsSettingsSection", () => ({
  default: function AccountsSettingsSectionMock() {
    return <div data-testid="settings-accounts-section">accounts section</div>;
  },
}));

vi.mock("@/components/settings/sections/ActualBudgetSettingsSection", () => ({
  default: function ActualBudgetSettingsSectionMock() {
    return <div data-testid="settings-actual-section">actual section</div>;
  },
}));

vi.mock("@/components/settings/sections/EmailAutomationSettingsSection", () => ({
  default: function EmailAutomationSettingsSectionMock({ patch }) {
    return (
      <div data-testid="settings-briefing-section">
        email automation section
        <button
          type="button"
          onClick={() => patch({ triage_sound_settings: mockApi.soundSettingsPayload })}
        >
          Mock Save Sound Track
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/settings/sections/SystemSettingsSection", () => ({
  default: function SystemSettingsSectionMock() {
    return <div data-testid="settings-system-section">system section</div>;
  },
}));

const { default: Settings } = await import("./Settings.jsx");

function renderSettings() {
  return render(
    <BrowserRouter>
      <Settings />
    </BrowserRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.history.replaceState({}, "", "/settings");
  mockApi.getAccounts.mockResolvedValue([]);
  mockApi.getSettings.mockResolvedValue({});
  mockApi.updateSettings.mockResolvedValue({ success: true });
});

describe("Settings page", () => {
  it("uses the tab query param to choose the initial section", async () => {
    window.history.replaceState({}, "", "/settings?tab=briefing");

    renderSettings();

    expect(await screen.findByTestId("settings-briefing-section")).toBeTruthy();
    expect(screen.queryByTestId("settings-accounts-section")).toBeNull();
  });

  it("renders the shared loading chrome while settings are still loading", () => {
    mockApi.getAccounts.mockReturnValue(new Promise(() => {}));
    mockApi.getSettings.mockReturnValue(new Promise(() => {}));

    const { container } = renderSettings();

    expect(screen.getByText("Settings")).toBeTruthy();
    expect(container.querySelectorAll(".animate-pulse").length).toBe(3);
    expect(screen.queryByTestId("settings-accounts-section")).toBeNull();
  });

  it("switches sections by changing page-level tab state", async () => {
    renderSettings();

    expect(await screen.findByTestId("settings-accounts-section")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Actual Budget" }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-actual-section")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=actual");

    fireEvent.click(screen.getByRole("button", { name: "System" }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-system-section")).toBeTruthy();
    });
    expect(screen.queryByTestId("settings-accounts-section")).toBeNull();
  });

  it("uses browser back and forward to move between settings tabs", async () => {
    renderSettings();

    expect(await screen.findByTestId("settings-accounts-section")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Email Automation" }));
    await waitFor(() => {
      expect(screen.getByTestId("settings-briefing-section")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=briefing");

    fireEvent.click(screen.getByRole("button", { name: "System" }));
    await waitFor(() => {
      expect(screen.getByTestId("settings-system-section")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=system");

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-briefing-section")).toBeTruthy();
    });

    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-system-section")).toBeTruthy();
    });
  });

  it("flushes pending settings when leaving before the autosave debounce fires", async () => {
    window.history.replaceState({}, "", "/settings?tab=briefing");

    const { unmount } = renderSettings();

    expect(await screen.findByTestId("settings-briefing-section")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mock Save Sound Track" }));
    unmount();

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        triage_sound_settings: mockApi.soundSettingsPayload,
      });
    });
  });
});
