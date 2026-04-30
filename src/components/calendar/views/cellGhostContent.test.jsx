import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDeadlinesCellContents } from "./deadlines/DeadlinesCellContent.jsx";
import { renderEventsCellContents } from "./events/EventsCellContent.jsx";

const layout = { tier: "lg" };

afterEach(() => {
  cleanup();
});

describe("calendar cell ghost content", () => {
  it("renders event ghosts like event chips with a 12-hour leading time", () => {
    render(renderEventsCellContents({
      items: [],
      ghosts: [{
        id: "event-ghost",
        kind: "event",
        title: "Planning block",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "12:30",
        endTime: "13:00",
        startMs: new Date("2026-04-20T19:30:00.000Z").getTime(),
        endMs: new Date("2026-04-20T20:00:00.000Z").getTime(),
        color: "#4285f4",
      }],
      layout,
      day: 20,
      dateKey: "2026-04-20",
    }));

    const chip = screen.getByTestId("calendar-ghost-chip");
    expect(chip.textContent).toContain("12:30 PM");
    expect(chip.textContent).toContain("Planning block");
    expect(chip.textContent).not.toMatch(/draft|conflict|repeat/i);
  });

  it("renders deadline ghosts with deadline source color and due-time ordering", () => {
    render(renderDeadlinesCellContents({
      items: [
        { id: "late", title: "Late task", due_date: "2026-04-20", due_time: "5:00 PM", source: "todoist", status: "open" },
      ],
      ghosts: [{
        id: "deadline-ghost",
        kind: "deadline",
        title: "Morning task",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        dueTime: "9:00 AM",
        dueMinutes: 540,
        source: "todoist",
        color: "#e8776a",
      }],
      layout,
      day: 20,
      dateKey: "2026-04-20",
    }));

    const chips = screen.getAllByText(/Morning task|Late task/).map((node) => node.textContent);
    expect(chips).toEqual(["Morning task", "Late task"]);
    expect(screen.getByTestId("calendar-ghost-chip").textContent).toContain("9:00 AM");
  });
});
