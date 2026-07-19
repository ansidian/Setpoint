import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import type { SettingsPatch } from "@/components/settings/settingsTypes";
import type { TriageSoundSettings } from "../../shared/types/settings";

const mockApi = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getCapabilities: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  targetReadyDelayMs: 0,
  soundSettingsPayload: {
    laneScope: "needs_attention_and_fyi",
    volume: 1,
    triggers: {
      needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
      email_queued: { enabled: true, soundId: "quick_chime" },
      fyi_finalized: { enabled: true, soundId: "smooth_modern" },
      weak_security_grace: { enabled: true, soundId: "low_tone" },
      triage_failed: { enabled: false, soundId: "low_tone" },
      event_upcoming: { enabled: true, soundId: "clear_chime" },
      task_completed: { enabled: true, soundId: "smooth_modern" },
    },
  } as TriageSoundSettings,
}));

vi.mock("@/api", () => ({
  getAccounts: mockApi.getAccounts,
  getCapabilities: mockApi.getCapabilities,
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
  default: function EmailAutomationSettingsSectionMock({ patch }: { patch: SettingsPatch }) {
    const [targetReady, setTargetReady] = useState(mockApi.targetReadyDelayMs === 0);
    useEffect(() => {
      if (targetReady) return;
      const timer = window.setTimeout(() => setTargetReady(true), mockApi.targetReadyDelayMs);
      return () => window.clearTimeout(timer);
    }, [targetReady]);
    return (
      <div
        id="ai-provider-credentials"
        tabIndex={-1}
        aria-busy={!targetReady}
        data-settings-target-ready={targetReady ? "true" : "false"}
        data-testid="settings-briefing-section"
      >
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

const { default: Settings } = await import("./Settings");

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
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.history.replaceState({}, "", "/settings");
  mockApi.getAccounts.mockResolvedValue([]);
  mockApi.getCapabilities.mockResolvedValue({ generatedAt: "2026-07-18T00:00:00.000Z", capabilities: [] });
  mockApi.getSettings.mockResolvedValue({});
  mockApi.updateSettings.mockResolvedValue({ success: true });
  mockApi.targetReadyDelayMs = 0;
});

describe("Settings page", () => {
  it("uses the tab query param to choose the initial section", async () => {
    window.history.replaceState({}, "", "/settings?tab=briefing");

    renderSettings();

    expect(await screen.findByTestId("settings-briefing-section")).toBeTruthy();
    expect(screen.queryByTestId("settings-accounts-section")).toBeNull();
  });

  it("waits for a linked settings card to finish loading, then flashes it after scrolling ends", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    mockApi.targetReadyDelayMs = 40;
    window.history.replaceState({}, "", "/settings?tab=briefing#ai-provider-credentials");

    renderSettings();

    const target = await screen.findByTestId("settings-briefing-section");
    expect(target.getAttribute("data-settings-target-ready")).toBe("false");
    expect(scrollIntoView).not.toHaveBeenCalled();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    }));
    expect(document.activeElement).toBe(target);
    expect(target.getAttribute("data-settings-target-active")).toBeNull();

    window.dispatchEvent(new Event("scrollend"));

    await waitFor(() => {
      expect(target.getAttribute("data-settings-target-active")).toBe("true");
    });
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

    fireEvent.click(screen.getByRole("tab", { name: "Actual Budget" }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-actual-section")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=actual");

    fireEvent.click(screen.getByRole("tab", { name: "System" }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-system-section")).toBeTruthy();
    });
    expect(screen.queryByTestId("settings-accounts-section")).toBeNull();
  });

  it("uses browser back and forward to move between settings tabs", async () => {
    renderSettings();

    expect(await screen.findByTestId("settings-accounts-section")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Email Automation" }));
    await waitFor(() => {
      expect(screen.getByTestId("settings-briefing-section")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=briefing");

    fireEvent.click(screen.getByRole("tab", { name: "System" }));
    await waitFor(() => {
      expect(screen.getByTestId("settings-system-section")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=system");

    act(() => {
      window.history.back();
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-briefing-section")).toBeTruthy();
    });

    act(() => {
      window.history.forward();
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

describe("Settings sections tablist (WAI-ARIA)", () => {
  it("exposes a tablist with one selected tab and a labelled tabpanel", async () => {
    renderSettings();
    await screen.findByTestId("settings-accounts-section");

    const tablist = screen.getByRole("tablist", { name: "Settings sections" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(4);

    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toBe("Accounts & Integrations");

    for (const tab of tabs) {
      const isActive = tab.textContent === "Accounts & Integrations";
      expect(tab.tabIndex).toBe(isActive ? 0 : -1);
    }

    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-label")).toBe("Accounts & Integrations");
  });

  it("ArrowDown moves selection to the next section and switches content (vertical strip)", async () => {
    renderSettings();
    await screen.findByTestId("settings-accounts-section");

    const activeTab = screen.getByRole("tab", { name: "Accounts & Integrations" });
    activeTab.focus();
    fireEvent.keyDown(activeTab, { key: "ArrowDown" });

    await waitFor(() => {
      expect(screen.getByTestId("settings-actual-section")).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "Actual Budget" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe("Actual Budget");
  });

  it("Home and End jump to the first and last section", async () => {
    renderSettings();
    await screen.findByTestId("settings-accounts-section");

    const activeTab = screen.getByRole("tab", { name: "Accounts & Integrations" });
    activeTab.focus();
    fireEvent.keyDown(activeTab, { key: "End" });

    await waitFor(() => {
      expect(screen.getByTestId("settings-system-section")).toBeTruthy();
    });

    fireEvent.keyDown(screen.getByRole("tab", { name: "System" }), { key: "Home" });

    await waitFor(() => {
      expect(screen.getByTestId("settings-accounts-section")).toBeTruthy();
    });
  });
});
