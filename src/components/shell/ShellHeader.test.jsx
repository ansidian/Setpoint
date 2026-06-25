import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShellHeader from "./ShellHeader.jsx";

const currentStatus = {
  state: "current",
  sources: [
    {
      key: "currentData",
      label: "Current data",
      state: "current",
      lastSuccessAt: "2026-05-04T12:00:00.000Z",
      message: "Current dashboard data is fresh.",
    },
    {
      key: "todoist",
      label: "Todoist",
      state: "current",
      lastSuccessAt: "2026-05-04T11:58:00.000Z",
      message: "Todoist mirror is current.",
    },
  ],
};

function renderHeader(overrides = {}) {
  return render(
    <MemoryRouter>
      <ShellHeader
        tab="dashboard"
        onTab={vi.fn()}
        onOpenPalette={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onOpenHistory={vi.fn()}
        onOpenCalendar={vi.fn()}
        onQuickRefresh={vi.fn()}
        systemStatus={currentStatus}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("ShellHeader system status", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("shows a compact current status button and opens provider rows", () => {
    renderHeader();

    const button = screen.getByRole("button", { name: /system status: current/i });
    expect(button).toBeTruthy();
    expect(within(button).getByTestId("system-status-signal")).toBeTruthy();

    fireEvent.click(button);

    const panel = screen.getByRole("dialog", { name: /system status/i });
    expect(within(panel).getByText("Current data")).toBeTruthy();
    expect(within(panel).getByText("Todoist")).toBeTruthy();
    expect(within(panel).getByText("Current dashboard data is fresh.")).toBeTruthy();
    expect(within(panel).getByText("Todoist mirror is current.")).toBeTruthy();
  });

  it("exposes a reachable close control that dismisses the system status panel", () => {
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: /system status: current/i }));

    const panel = screen.getByRole("dialog", { name: /system status/i });
    const closeButton = within(panel).getByRole("button", { name: /close system status/i });

    fireEvent.click(closeButton);

    expect(screen.queryByRole("dialog", { name: /system status/i })).toBeNull();
  });

  it("uses an attention label when system health needs sync", () => {
    renderHeader({
      systemStatus: {
        ...currentStatus,
        state: "needs_sync",
        sources: [
          { ...currentStatus.sources[0], state: "refreshing", severity: "info", message: "Current data is refreshing." },
          { ...currentStatus.sources[1], state: "needs_sync", severity: "warning", message: "Todoist mirror needs sync." },
        ],
      },
    });

    const button = screen.getByRole("button", { name: /system status: needs_sync/i });
    expect(button).toBeTruthy();

    fireEvent.click(button);
    const panel = screen.getByRole("dialog", { name: /system status/i });
    expect(within(panel).getByText("Needs sync")).toBeTruthy();
    expect(within(panel).getByText("Refreshing")).toBeTruthy();
  });

  it("treats stale status as needs sync", () => {
    renderHeader({
      systemStatus: {
        ...currentStatus,
        state: "stale",
        sources: [
          { ...currentStatus.sources[0], state: "stale", message: "Some current dashboard data is stale." },
          currentStatus.sources[1],
        ],
      },
    });

    expect(screen.getByRole("button", { name: /system status: needs_sync/i })).toBeTruthy();
  });

  it("labels the snapshots dropdown shortcut as Y", () => {
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: /open more actions/i }));

    const snapshotsItem = screen.getByRole("button", { name: /snapshots/i });
    expect(within(snapshotsItem).getByText("Y")).toBeTruthy();
    expect(within(snapshotsItem).queryByText("H")).toBeNull();
  });

  it("keeps shell controls accessible without native hover tooltips", () => {
    renderHeader();

    expect(screen.getByRole("button", { name: /open analytics/i }).getAttribute("title")).toBe(null);
    expect(screen.getByRole("button", { name: /open command palette/i }).getAttribute("title")).toBe(null);
    expect(screen.getByRole("button", { name: /system status: current/i }).getAttribute("title")).toBe(null);
    expect(screen.getByRole("button", { name: /sync now/i }).getAttribute("title")).toBe(null);
  });

  it("places analytics before command palette in the shell action cluster", () => {
    renderHeader();

    const header = screen.getByTestId("shell-header-desktop");
    const controls = within(header).getAllByRole("button");
    const labels = controls.map((control) => control.getAttribute("aria-label") || control.textContent);

    expect(labels.indexOf("Open analytics")).toBeLessThan(labels.indexOf("Open command palette"));
    expect(labels.indexOf("Open command palette")).toBeLessThan(labels.indexOf("Sync now"));
    expect(labels.indexOf("Sync now")).toBeLessThan(labels.indexOf("System status: current"));
  });

  it("shows a quiet demo data marker in demo mode", () => {
    vi.stubEnv("VITE_EA_DEMO", "1");

    renderHeader();

    const marker = screen.getByLabelText(/demo data: mocked data/i);
    expect(marker).toBeTruthy();
    expect(marker.textContent).toBe("Demo data");
  });

  it("opens analytics and exposes active state for the shell analytics tint", () => {
    const onOpenAnalytics = vi.fn();
    renderHeader({ onOpenAnalytics, analyticsOpen: true });

    const button = screen.getByRole("button", { name: /open analytics/i });
    fireEvent.click(button);

    expect(onOpenAnalytics).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("moves analytics into the mobile overflow menu and keeps Sync now on one row", () => {
    const onOpenAnalytics = vi.fn();
    renderHeader({ isMobile: true, onOpenAnalytics });

    expect(screen.queryByRole("button", { name: /open analytics/i })).toBeNull();
    const syncButton = screen.getByRole("button", { name: /sync now/i });
    expect(within(syncButton).getByText("Sync now")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /open more actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /analytics/i }));

    expect(onOpenAnalytics).toHaveBeenCalledTimes(1);
  });

  it("hides the top tab strip on mobile (MobileBottomNav takes over), keeps it on desktop", () => {
    renderHeader();
    expect(screen.getByText("Calendar")).toBeTruthy(); // desktop strip present

    cleanup();
    renderHeader({ isMobile: true });
    expect(screen.queryByText("Notes")).toBeNull(); // mobile strip gone
    expect(screen.queryByText("Calendar")).toBeNull();
  });
});
