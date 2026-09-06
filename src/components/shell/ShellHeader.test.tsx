import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
