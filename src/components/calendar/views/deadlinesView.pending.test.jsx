import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

const completeTask = vi.fn();
const updateTaskStatus = vi.fn();
const dismissTombstone = vi.fn();

vi.mock("../../../api", async () => {
  const actual = await vi.importActual("../../../api");
  return {
    ...actual,
    completeTask,
    updateTaskStatus,
    dismissTombstone,
  };
});

const { DashboardProvider } = await import("../../../context/DashboardContext.jsx");
const { default: deadlinesView } = await import("./deadlinesView.jsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function DeferredCompleteHarness() {
  const [briefing, setBriefing] = useState({
    emails: { accounts: [] },
    ctm: { upcoming: [] },
    todoist: {
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
      {deadlinesView.renderDetail({
        selectedDay: 19,
        viewYear: 2026,
        viewMonth: 3,
        items: briefing.todoist.upcoming,
        selectedItemId: "todo-1",
        onSelectItem: () => {},
      })}
    </DashboardProvider>
  );
}

describe("deadlinesView Todoist completion feedback", () => {
  it("shows an immediate pending state while the Todoist close is in flight", async () => {
    let resolveComplete;
    completeTask.mockImplementationOnce(() => new Promise((resolve) => {
      resolveComplete = resolve;
    }));

    render(<DeferredCompleteHarness />);

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /completing/i })).toBeTruthy();
    });

    resolveComplete({});
  });
});
