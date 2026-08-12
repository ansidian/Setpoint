import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router";

const mockApi = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getCapabilities: vi.fn(),
  getInstanceCredentials: vi.fn(),
  getOnboardingProgress: vi.fn(),
  getRemoteContentTrust: vi.fn(),
  getSettings: vi.fn(),
  getTriageCacheStats: vi.fn(),
  getImportantSenders: vi.fn(),
  listApiTokens: vi.fn(),
  listPasskeys: vi.fn(),
  updateSettings: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({
  getCanonicalOriginStatus: vi.fn(),
}));
const mockTodoist = vi.hoisted(() => ({
  getTodoistConnectionStatus: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- the Settings page talks to API wrappers at this external network boundary while real sections and cards render below it.
vi.mock("@/api", () => ({
  ...mockApi,
}));

// test-architecture: allow-boundary-mock -- onboarding progress is an authenticated server boundary; the real Settings page consumes its returned projection.
vi.mock("@/lib/onboardingApi", () => ({
  getOnboardingProgress: mockApi.getOnboardingProgress,
}));

// test-architecture: allow-boundary-mock -- security status is a server-owned credential boundary; System renders the real security cards around this fake response.
vi.mock("@/auth/securityApi", () => ({
  getCanonicalOriginStatus: mockSecurity.getCanonicalOriginStatus,
}));

// test-architecture: allow-boundary-mock -- Todoist status is an authenticated server HTTP boundary; the real Todoist card remains mounted for deep-link behavior around the returned provider-health projection.
vi.mock("@/lib/todoistSetupApi", () => ({
  getTodoistConnectionStatus: mockTodoist.getTodoistConnectionStatus,
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
  mockApi.getInstanceCredentials.mockResolvedValue({ credentials: [] });
  mockApi.getOnboardingProgress.mockResolvedValue({
    version: 1,
    status: "in_progress",
    steps: { ai: "reviewed" },
    completedAt: null,
    updatedAt: 1,
  });
  mockApi.getRemoteContentTrust.mockResolvedValue([]);
  mockApi.getSettings.mockResolvedValue({});
  mockApi.getTriageCacheStats.mockResolvedValue({ openaiCalls: 0, windowDays: 7 });
  mockApi.getImportantSenders.mockResolvedValue([]);
  mockApi.listApiTokens.mockResolvedValue([]);
  mockApi.listPasskeys.mockResolvedValue({
    passkeys: [],
    authMode: "password_or_passkey",
    recovery: { remaining: 0, generatedAt: null },
  });
  mockApi.updateSettings.mockResolvedValue({ success: true });
  mockSecurity.getCanonicalOriginStatus.mockResolvedValue({
    currentOrigin: "https://setpoint.example",
    proposedOrigin: "https://setpoint.example",
    affectedPasskeys: 0,
    callbacks: [],
    recentAuth: false,
  });
  mockTodoist.getTodoistConnectionStatus.mockResolvedValue({
    mode: "disconnected",
    configured: false,
    oauthRefreshable: false,
    needsReauth: false,
    application: {
      configured: false,
      source: "absent",
      pendingConfigured: false,
      pendingStagedAt: null,
      pendingExpiresAt: null,
      candidateVersions: null,
    },
    callbackUrl: "https://setpoint.example/api/ea/accounts/todoist/callback",
    webhookUrl: "https://setpoint.example/api/todoist/webhook",
    deliveryMode: "periodic",
  });
});

describe("Settings page", () => {
  it("uses the tab query param to choose the initial section", async () => {
    window.history.replaceState({}, "", "/settings?tab=automation");

    renderSettings();

    expect(await screen.findByText("Connect an email source")).toBeTruthy();
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe("Automation");
    expect(screen.queryByText("Connections directory")).toBeNull();
  });

  it("coordinates onboarding progress once for the Connections workflow", async () => {
    renderSettings();

    expect(await screen.findByText("Connections directory")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue setup" })).toBeTruthy();
  });

  it("locates and focuses a deep-linked connection row, then flashes it after scrolling ends", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    window.history.replaceState({}, "", "/settings?tab=connections#todoist");

    renderSettings();

    const target = await screen.findByRole("button", { name: /Todoist/ });
    // test-architecture: allow-boundary-interaction -- focus and flash state cannot prove the deep-link reveal crossed the browser scroll boundary with centered smooth scrolling.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    }));
    expect(document.activeElement).toBe(target);

    window.dispatchEvent(new Event("scrollend"));

    await waitFor(() => {
      expect(target.closest("[data-settings-flash-container]")?.getAttribute("data-settings-target-active")).toBe("true");
    });
  });

  it("does not scroll, focus, or flash a drawer expanded from inside Settings", async () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    window.history.replaceState(
      { usr: { settingsTargetReveal: "suppress" } },
      "",
      "/settings?tab=connections#todoist",
    );

    try {
      renderSettings();
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const target = screen.getByRole("button", { name: /Todoist/ });
      window.dispatchEvent(new Event("scrollend"));

      // test-architecture: allow-boundary-interaction -- visible drawer state cannot prove local expansion avoided the browser scroll boundary reserved for inbound deep links.
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(target);
      expect(target.closest("[data-settings-flash-container]")?.getAttribute("data-settings-target-active")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("focuses the requested Advanced setup disclosure instead of the service row", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    window.history.replaceState({}, "", "/settings?tab=connections&setup=todoist-advanced#todoist");

    renderSettings();

    const advancedSummary = await screen.findByText("Advanced OAuth and webhooks");
    // test-architecture: allow-boundary-interaction -- active-element state cannot prove the advanced disclosure used the required centered browser scroll operation.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    }));
    expect(document.activeElement).toBe(advancedSummary);
  });

  it("renders the shared loading chrome while settings are still loading", () => {
    mockApi.getAccounts.mockReturnValue(new Promise(() => {}));
    mockApi.getSettings.mockReturnValue(new Promise(() => {}));

    renderSettings();

    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading settings" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Connections directory")).toBeNull();
  });

  it("switches sections by changing page-level tab state", async () => {
    renderSettings();

    expect(await screen.findByText("Connections directory")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Finance" }));

    await waitFor(() => {
      expect(screen.getByText("Connect Actual Budget")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=finance");

    fireEvent.click(screen.getByRole("tab", { name: "System" }));

    await waitFor(() => {
      expect(screen.getByText("Sign-in & recovery")).toBeTruthy();
    });
    expect(screen.queryByText("Connections directory")).toBeNull();
  });

  it("uses browser back and forward to move between settings tabs", async () => {
    renderSettings();

    expect(await screen.findByText("Connections directory")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    await waitFor(() => {
      expect(screen.getByText("Connect an email source")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=automation");

    fireEvent.click(screen.getByRole("tab", { name: "System" }));
    await waitFor(() => {
      expect(screen.getByText("Sign-in & recovery")).toBeTruthy();
    });
    expect(window.location.search).toBe("?tab=system");

    act(() => {
      window.history.back();
    });
    await waitFor(() => {
      expect(screen.getByText("Connect an email source")).toBeTruthy();
    });

    act(() => {
      window.history.forward();
    });
    await waitFor(() => {
      expect(screen.getByText("Sign-in & recovery")).toBeTruthy();
    });
  });

  it("flushes pending settings when leaving before the autosave debounce fires", async () => {
    window.history.replaceState({}, "", "/settings?tab=automation");
    mockApi.getAccounts.mockResolvedValue([{
      id: "icloud-1",
      type: "icloud",
      email: "owner@icloud.com",
      label: "Owner",
      color: null,
      icon: null,
      calendar_enabled: 0,
      sort_order: 0,
      created_at: "2026-07-18T00:00:00.000Z",
      needs_reauth: false,
    }]);

    const { unmount } = renderSettings();

    const lookback = await screen.findByDisplayValue("16");
    fireEvent.change(lookback, { target: { value: "24" } });
    unmount();

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- after unmount there is no page state to observe; the outbound Settings write is the durability contract for pending edits.
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ email_lookback_hours: 24 });
    });
  });
});

describe("Settings sections tablist (WAI-ARIA)", () => {
  it("exposes a tablist with one selected tab and a labelled tabpanel", async () => {
    renderSettings();
    await screen.findByText("Connections directory");

    const tablist = screen.getByRole("tablist", { name: "Settings sections" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(4);

    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toBe("Connections");

    for (const tab of tabs) {
      const isActive = tab.textContent === "Connections";
      expect(tab.tabIndex).toBe(isActive ? 0 : -1);
    }

    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-label")).toBe("Connections");
  });

  it("ArrowDown moves selection to the next section and switches content (vertical strip)", async () => {
    renderSettings();
    await screen.findByText("Connections directory");

    const activeTab = screen.getByRole("tab", { name: "Connections" });
    activeTab.focus();
    fireEvent.keyDown(activeTab, { key: "ArrowDown" });

    await waitFor(() => {
      expect(screen.getByText("Connect an email source")).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "Automation" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe("Automation");
  });

  it("Home and End jump to the first and last section", async () => {
    renderSettings();
    await screen.findByText("Connections directory");

    const activeTab = screen.getByRole("tab", { name: "Connections" });
    activeTab.focus();
    fireEvent.keyDown(activeTab, { key: "End" });

    await waitFor(() => {
      expect(screen.getByText("Sign-in & recovery")).toBeTruthy();
    });

    fireEvent.keyDown(screen.getByRole("tab", { name: "System" }), { key: "Home" });

    await waitFor(() => {
      expect(screen.getByText("Connections directory")).toBeTruthy();
    });
  });
});
