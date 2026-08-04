import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ComponentType, ReactNode } from "react";

const completeDeadlineOccurrence = vi.fn();

// test-architecture: allow-boundary-mock -- Deadline completion tests replace only the outbound HTTP adapter; the real rendered detail state owns pending, success, failure, and reopen reconciliation without contacting Todoist.
vi.mock("../../../../api", async () => {
  const actual = await vi.importActual("../../../../api");
  return {
    ...actual,
    completeDeadlineOccurrence,
  };
});

const { DashboardProvider: StrictDashboardProvider } = await import("../../../../context/DashboardContext");
const DashboardProvider = StrictDashboardProvider as unknown as ComponentType<{
  children: ReactNode;
  [key: string]: unknown;
}>;
const { renderDeadlinesDetail } = await import("./DeadlinesDetailRail.tsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function DeferredCompleteHarness() {
  const [deadlines, setDeadlines] = useState({
    upcoming: [
      {
        id: "todo-1",
        title: "Ship report",
        due_date: "2026-04-19",
        due_time: "9:00 AM",
        source: "todoist",
        class_name: "Inbox",
        status: "open",
      },
    ],
    stats: { incomplete: 1, dueToday: 1, dueThisWeek: 1, totalPoints: 0 },
  });

  return (
    <DashboardProvider deadlines={deadlines} setCalendarDeadlines={setDeadlines}>
      {renderDeadlinesDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: deadlines.upcoming,
        selectedItemId: "todo-1",
        onSelectItem: () => {},
      })}
    </DashboardProvider>
  );
}

function ReconciledStatusHarness({ status }: { status: string }) {
  const task = {
    id: "todo-reopened",
    title: "Reopened report",
    due_date: "2026-04-19",
    due_time: "9:00 AM",
    source: "todoist",
    class_name: "Inbox",
    status,
  };
  const deadlines = {
    upcoming: [task],
    stats: { incomplete: status === "complete" ? 0 : 1, dueToday: 1, dueThisWeek: 1, totalPoints: 0 },
  };
  return (
    <DashboardProvider deadlines={deadlines} setCalendarDeadlines={() => {}}>
      {renderDeadlinesDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: deadlines.upcoming,
        selectedItemId: "todo-reopened",
        onSelectItem: () => {},
      })}
    </DashboardProvider>
  );
}

describe("deadline detail completion feedback", () => {
  it("shows an immediate pending state while deadline completion is in flight", async () => {
    let resolveComplete: ((value: unknown) => void) | undefined;
    completeDeadlineOccurrence.mockImplementationOnce(() => new Promise((resolve) => {
      resolveComplete = resolve;
    }));

    render(<DeferredCompleteHarness />);

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /mark complete/i }).getAttribute("aria-busy")).toBe("true");
    });

    resolveComplete?.({});
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
    });
  });

  it("returns to the ready action when Todoist completion fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    completeDeadlineOccurrence.mockRejectedValueOnce(new Error("Todoist unavailable"));

    render(<DeferredCompleteHarness />);

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /mark complete/i }).getAttribute("aria-busy")).toBe("true");
    });
    await waitFor(() => {
      const action = screen.getByRole<HTMLButtonElement>("button", { name: /mark complete/i });
      expect(action.getAttribute("aria-busy")).not.toBe("true");
      expect(action.disabled).toBe(false);
    });

    errorSpy.mockRestore();
  });

  it("offers completion again when a completed Todoist deadline reconciles as reopened", () => {
    const view = render(<ReconciledStatusHarness status="complete" />);
    expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();

    view.rerender(<ReconciledStatusHarness status="open" />);

    expect(screen.getByRole("button", { name: /mark complete/i })).toBeTruthy();
  });
});
