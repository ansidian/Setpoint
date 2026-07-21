import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  checkAuth: vi.fn(),
  getSetupStatus: vi.fn(),
  getOnboardingProgress: vi.fn(),
  prefetchCurrentDashboard: vi.fn(),
}));
const routeFailures = vi.hoisted(() => ({
  login: false,
  settings: false,
}));

vi.mock("./api", () => ({
  checkAuth: mockApi.checkAuth,
  prefetchCurrentDashboard: mockApi.prefetchCurrentDashboard,
}));

vi.mock("./setupApi", () => ({
  getSetupStatus: mockApi.getSetupStatus,
}));

vi.mock("./lib/onboardingApi", () => ({
  getOnboardingProgress: mockApi.getOnboardingProgress,
}));

vi.mock("./pages/OwnerSetup", () => ({
  default: function OwnerSetupMock({ onClaimed }: { onClaimed: () => void }) {
    return <button data-testid="owner-setup-page" onClick={onClaimed}>claim</button>;
  },
}));

vi.mock("./pages/Login", () => ({
  default: function LoginMock() {
    if (routeFailures.login) throw new Error("Login render failed");
    return <div data-testid="login-page">login</div>;
  },
}));

vi.mock("./pages/Dashboard", () => ({
  default: function DashboardMock() {
    return <div data-testid="dashboard-page">dashboard</div>;
  },
}));

vi.mock("./pages/SettingsRoute", () => ({
  default: function SettingsRouteMock() {
    if (routeFailures.settings) throw new Error("Settings render failed");
    return <div data-testid="settings-page">settings</div>;
  },
}));

vi.mock("./pages/Onboarding", () => ({
  default: function OnboardingMock() {
    return <div data-testid="onboarding-page">onboarding</div>;
  },
}));

const { default: App } = await import("./App");
const { resolveRouterBasename } = await import("./routerBase");

describe("App auth redirects", () => {
  beforeEach(() => {
    routeFailures.login = false;
    routeFailures.settings = false;
    mockApi.checkAuth.mockResolvedValue({ authenticated: true });
    mockApi.getSetupStatus.mockResolvedValue({ claimed: true });
    mockApi.getOnboardingProgress.mockResolvedValue({ status: "complete" });
    window.history.replaceState({}, "", "/");
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    window.history.replaceState({}, "", "/");
  });

  it("replaces /login in history when redirecting an authenticated user", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.history.pushState({}, "", "/from-here");
    window.history.pushState({}, "", "/login");

    render(<App />);

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/");

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/from-here");
    });
  });

  it("opens settings from the command-comma shortcut", async () => {
    render(<App />);

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();

    fireEvent.keyDown(window, { key: ",", metaKey: true });

    expect(
      await screen.findByTestId("settings-page", undefined, { timeout: 5000 }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/settings");
  });

  it("warms the dashboard data prefetch once authenticated", async () => {
    render(<App />);

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
    expect(mockApi.prefetchCurrentDashboard).toHaveBeenCalledTimes(1);
  });

  it("does not prefetch dashboard data on an unauthenticated session", async () => {
    mockApi.checkAuth.mockResolvedValue({ authenticated: false });

    render(<App />);

    expect(await screen.findByTestId("login-page")).toBeTruthy();
    expect(mockApi.prefetchCurrentDashboard).not.toHaveBeenCalled();
  });

  it("routes an unclaimed instance to owner setup without checking auth", async () => {
    mockApi.getSetupStatus.mockResolvedValue({ claimed: false });
    window.history.replaceState({}, "", "/");

    render(<App />);

    expect(await screen.findByTestId("owner-setup-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/setup");
    expect(mockApi.checkAuth).not.toHaveBeenCalled();
    expect(mockApi.prefetchCurrentDashboard).not.toHaveBeenCalled();
  });

  it("routes a newly claimed owner into onboarding", async () => {
    mockApi.getSetupStatus.mockResolvedValue({ claimed: false });

    render(<App />);
    fireEvent.click(await screen.findByTestId("owner-setup-page"));

    expect(await screen.findByTestId("onboarding-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/onboarding");
  });

  it("resumes unfinished onboarding after login without blocking direct dashboard access", async () => {
    mockApi.getOnboardingProgress.mockResolvedValue({ status: "in_progress" });
    window.history.replaceState({}, "", "/login");

    render(<App />);

    expect(await screen.findByTestId("onboarding-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/onboarding");

    cleanup();
    window.history.replaceState({}, "", "/");
    render(<App />);
    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
  });

  it("shows a recoverable fallback when Login throws during render", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    routeFailures.login = true;
    mockApi.checkAuth.mockResolvedValue({ authenticated: false });
    window.history.replaceState({}, "", "/login");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "This view hit an error" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows a recoverable fallback when Settings throws during render", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    routeFailures.settings = true;
    window.history.replaceState({}, "", "/settings");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "This view hit an error" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("bypasses auth checks in demo mode", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    mockApi.checkAuth.mockClear();

    render(<App />);

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
    expect(mockApi.checkAuth).not.toHaveBeenCalled();
    expect(mockApi.getSetupStatus).not.toHaveBeenCalled();
    expect(mockApi.prefetchCurrentDashboard).not.toHaveBeenCalled();
  });

  it("derives a router basename from Vite's deployment base", () => {
    expect(resolveRouterBasename("/")).toBeUndefined();
    expect(resolveRouterBasename("/Setpoint/")).toBe("/Setpoint");
    expect(resolveRouterBasename("/portfolio/demo")).toBe("/portfolio/demo");
  });
});
