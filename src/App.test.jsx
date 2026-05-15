import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  checkAuth: vi.fn(),
}));

vi.mock("./api", () => ({
  checkAuth: mockApi.checkAuth,
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

    expect(await screen.findByTestId("settings-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/settings");
  });

  it("bypasses auth checks in demo mode", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    mockApi.checkAuth.mockClear();

    render(<App />);

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
    expect(mockApi.checkAuth).not.toHaveBeenCalled();
  });

  it("derives a router basename from Vite's deployment base", () => {
    expect(resolveRouterBasename("/")).toBeUndefined();
    expect(resolveRouterBasename("/ea-dashboard/")).toBe("/ea-dashboard");
    expect(resolveRouterBasename("/portfolio/demo")).toBe("/portfolio/demo");
  });
});
