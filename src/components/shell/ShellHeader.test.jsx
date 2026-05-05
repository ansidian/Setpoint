import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    <ShellHeader
      tab="dashboard"
      onTab={vi.fn()}
      onOpenPalette={vi.fn()}
      onOpenCustomize={vi.fn()}
      onOpenHistory={vi.fn()}
      onOpenCalendar={vi.fn()}
      onQuickRefresh={vi.fn()}
      systemStatus={currentStatus}
      {...overrides}
    />,
  );
}

describe("ShellHeader system status", () => {
  afterEach(() => {
    cleanup();
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

  it("animates the system status close button on hover and keyboard focus", () => {
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: /system status: current/i }));

    const panel = screen.getByRole("dialog", { name: /system status/i });
    const closeButton = within(panel).getByRole("button", { name: /close system status/i });

    fireEvent.mouseEnter(closeButton);
    expect(closeButton.style.transform).toBe("translateY(-1px)");

    fireEvent.mouseLeave(closeButton);
    expect(closeButton.style.transform).toBe("translateY(0)");

    fireEvent.focus(closeButton);
    expect(closeButton.style.transform).toBe("translateY(-1px)");
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

  it("keeps shell controls accessible without native hover tooltips", () => {
    renderHeader();

    expect(screen.getByRole("button", { name: /open command palette/i }).getAttribute("title")).toBe(null);
    expect(screen.getByRole("button", { name: /system status: current/i }).getAttribute("title")).toBe(null);
    expect(screen.getByRole("button", { name: /sync now/i }).getAttribute("title")).toBe(null);
  });

  it("places system status after sync controls in the shell action cluster", () => {
    renderHeader();

    const header = screen.getByTestId("shell-header-desktop");
    const controls = within(header).getAllByRole("button");
    const labels = controls.map((control) => control.getAttribute("aria-label") || control.textContent);

    expect(labels.indexOf("Open command palette")).toBeLessThan(labels.indexOf("Sync now"));
    expect(labels.indexOf("Sync now")).toBeLessThan(labels.indexOf("System status: current"));
  });
});
