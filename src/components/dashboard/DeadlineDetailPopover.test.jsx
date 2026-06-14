import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext.jsx";
import DeadlineDetailPopover from "./DeadlineDetailPopover.jsx";

vi.mock("../todoist/AddTaskPanel", () => ({
  default: () => <div data-testid="add-task-panel" />,
}));

function renderPopover(task) {
  const anchor = document.createElement("button");
  anchor.getBoundingClientRect = () => ({
    left: 40,
    top: 40,
    right: 80,
    bottom: 70,
    width: 40,
    height: 30,
  });
  document.body.appendChild(anchor);
  render(
    <DashboardProvider
      deadlines={{ upcoming: [task], stats: null }}
      setCalendarDeadlines={() => {}}
    >
      <DeadlineDetailPopover
        task={task}
        anchor={anchor}
        onClose={() => {}}
      />
    </DashboardProvider>,
  );
}

describe("DeadlineDetailPopover", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("shows deadline-domain actions without CTM or Canvas branches", () => {
    renderPopover({
      id: "deadline-1",
      title: "Submit packet",
      due_date: "2026-05-07",
      class_name: "School",
      source: "canvas",
      status: "open",
      priority: 2,
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Deadline");
    expect(dialog.textContent).toContain("Submit packet");
    expect(screen.getByRole("button", { name: /mark complete/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open canvas/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open ctm/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /in progress/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });
});
