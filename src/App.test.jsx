import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  checkAuth: vi.fn(),
  prefetchCurrentDashboard: vi.fn(),
}));

vi.mock("./api", () => ({
  checkAuth: mockApi.checkAuth,
  prefetchCurrentDashboard: mockApi.prefetchCurrentDashboard,
}));

vi.mock("./pages/Login", () => ({
  default: function LoginMock() {
    return <div data-testid="login-page">login</div>;
  },
}));

vi.mock("./pages/Dashboard", () => ({
  default: function DashboardMock() {
    return <div data-testid="dashboard-page">dashboard</div>;
  },
}));

vi.mock("./pages/Settings", () => ({
  default: function SettingsMock() {
    return <div data-testid="settings-page">settings</div>;
  },
}));

const { default: App } = await import("./App.jsx");
const { resolveRouterBasename } = await import("./routerBase.js");

describe("App auth redirects", () => {
  beforeEach(() => {
    mockApi.checkAuth.mockResolvedValue({ authenticated: true });
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

  it("bypasses auth checks in demo mode", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    mockApi.checkAuth.mockClear();

    render(<App />);

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
    expect(mockApi.checkAuth).not.toHaveBeenCalled();
    expect(mockApi.prefetchCurrentDashboard).not.toHaveBeenCalled();
  });

  it("derives a router basename from Vite's deployment base", () => {
    expect(resolveRouterBasename("/")).toBeUndefined();
    expect(resolveRouterBasename("/Setpoint/")).toBe("/Setpoint");
    expect(resolveRouterBasename("/portfolio/demo")).toBe("/portfolio/demo");
  });
});
