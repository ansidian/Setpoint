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

    fireEvent.click(button);

    const panel = screen.getByRole("dialog", { name: /system status/i });
    expect(within(panel).getByText("Current data")).toBeTruthy();
    expect(within(panel).getByText("Todoist")).toBeTruthy();
    expect(within(panel).getByText("Current dashboard data is fresh.")).toBeTruthy();
    expect(within(panel).getByText("Todoist mirror is current.")).toBeTruthy();
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

  it("treats legacy stale status as needs sync during migration", () => {
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
});
