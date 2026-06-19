import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  getNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  reorderNotes: vi.fn(),
  archiveNote: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../todoist/AddTaskPanel.jsx", () => ({
  default: ({ onTaskAdded }) => (
    <button type="button" data-testid="fake-add-task" onClick={() => onTaskAdded({ id: 99 })}>add</button>
  ),
}));

import { getNotes } from "../../api.js";
import NotesTab from "./NotesTab.jsx";

describe("NotesTab", () => {
  afterEach(cleanup);

  beforeEach(() => {
    getNotes.mockResolvedValue([
      { id: 1, content: "active note one", sort_order: 0, created_at: "2026-06-18 10:00:00", archived_at: null },
      { id: 2, content: "an archived thing", sort_order: 1, created_at: "2026-06-01 10:00:00", archived_at: "2026-06-02 10:00:00" },
    ]);
  });

  it("shows active notes and hides archived ones by default", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());
    expect(screen.queryByText("an archived thing")).toBeNull();
    expect(screen.getByPlaceholderText(/jot something down/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/search/i)).toBeTruthy();
  });

  it("promotes a note to a task and auto-archives it", async () => {
    const { archiveNote } = await import("../../api.js");
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Add to Todoist")); // opens the (mocked) panel
    fireEvent.click(screen.getByTestId("fake-add-task"));      // simulate a successful create

    await waitFor(() => expect(archiveNote).toHaveBeenCalledWith(1, true));
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull()); // left the active list
  });
});
