import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardTab } from "../dashboard/dashboardShellModel";
import ShellHeader from "./ShellHeader";

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

function NotesHeaderHarness() {
  const [tab, setTab] = useState<DashboardTab>("notes");
  return (
    <MemoryRouter>
      <ShellHeader
        tab={tab}
        onTab={setTab}
        onOpenPalette={() => {}}
        onOpenAnalytics={() => {}}
        onOpenHistory={() => {}}
        onOpenCalendar={() => {}}
        onQuickRefresh={() => {}}
        systemStatus={currentStatus}
      />
      <output aria-label="Active shell tab">{tab}</output>
    </MemoryRouter>
  );
}

describe("ShellHeader", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens provider status details and exposes a reachable dismissal", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /system status: current/i }));

    const panel = screen.getByRole("dialog", { name: /system status/i });
    expect(within(panel).getByText("Current data")).toBeTruthy();
    expect(within(panel).getByText("Todoist")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: /close system status/i }));
    expect(screen.queryByRole("dialog", { name: /system status/i })).toBeNull();
  });

  it("announces sync progress to assistive tech", () => {
    renderHeader({ refreshing: true });

    const button = screen.getByRole("button", { name: /syncing/i });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Syncing…");
  });

  it("routes a backtick-number chord from Notes before the canvas receives the digit", () => {
    const canvasKeydown = vi.fn();
    document.addEventListener("keydown", canvasKeydown);
    render(<NotesHeaderHarness />);

    fireEvent.keyDown(document.body, { key: "`", code: "Backquote" });
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1" });

    expect(screen.getByLabelText("Active shell tab").textContent).toBe("dashboard");
    // test-architecture: allow-boundary-interaction -- The document listener stands in for the Notes canvas browser boundary; capture must stop the destination digit before it reaches that boundary.
    expect(canvasKeydown).not.toHaveBeenCalled();
    document.removeEventListener("keydown", canvasKeydown);
  });

  it("expires the Notes navigation chord after 900ms", () => {
    vi.useFakeTimers();
    render(<NotesHeaderHarness />);

    fireEvent.keyDown(document.body, { key: "`", code: "Backquote" });
    vi.advanceTimersByTime(901);
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1" });

    expect(screen.getByLabelText("Active shell tab").textContent).toBe("notes");
  });
});
