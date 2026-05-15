import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

const completeDeadlineOccurrence = vi.fn();

vi.mock("../../../../api", async () => {
  const actual = await vi.importActual("../../../../api");
  return {
    ...actual,
    completeDeadlineOccurrence,
  };
});

const { DashboardProvider } = await import("../../../../context/DashboardContext.jsx");
const { renderDeadlinesDetail } = await import("./DeadlinesDetailRail.jsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function DeferredCompleteHarness() {
  const [briefing, setBriefing] = useState({
    emails: { accounts: [] },
    deadlines: {
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
    },
  });

  return (
    <DashboardProvider briefing={briefing} setBriefing={setBriefing} setCalendarDeadlines={() => {}}>
      {renderDeadlinesDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: briefing.deadlines.upcoming,
        selectedItemId: "todo-1",
        onSelectItem: () => {},
      })}
    </DashboardProvider>
  );
}

describe("deadline detail completion feedback", () => {
  it("shows an immediate pending state while deadline completion is in flight", async () => {
    let resolveComplete;
    completeDeadlineOccurrence.mockImplementationOnce(() => new Promise((resolve) => {
      resolveComplete = resolve;
    }));

    render(<DeferredCompleteHarness />);

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /mark complete/i }).getAttribute("aria-busy")).toBe("true");
    });

    resolveComplete({});
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
      expect(screen.getByRole("button", { name: /mark complete/i })).toBeTruthy();
    });

    errorSpy.mockRestore();
  });
});
