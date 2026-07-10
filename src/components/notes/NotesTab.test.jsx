import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  getNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn().mockResolvedValue({ success: true }),
  reorderNotes: vi.fn(),
  archiveNote: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../todoist/AddTaskPanel.jsx", () => ({
  default: ({ onTaskAdded }) => (
    <button type="button" data-testid="fake-add-task" onClick={() => onTaskAdded({ id: 99 })}>add</button>
  ),
}));

// Stub the CodeMirror-backed editor so NotesTab tests never mount real CM under
// happy-dom. Preserves the placeholder so existing placeholder-based queries hold.
vi.mock("./NoteEditor.jsx", () => ({
  default: (props) => (
    <textarea
      data-testid="note-editor"
      placeholder={props.placeholder}
      value={props.value || ""}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}));

import { getNotes } from "../../api.js";
import NotesTab from "./NotesTab.jsx";

describe("NotesTab", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks(); // reset call counts (keeps mockResolvedValue impls) so delete tests are order-independent
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

  it("does not autofocus the capture field on entry", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());
    const capture = screen.getByPlaceholderText(/jot something down/i);
    expect(document.activeElement).not.toBe(capture);
  });

  it("promotes a note to a task and auto-archives it", async () => {
    const { archiveNote } = await import("../../api.js");
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    // open the row's action menu, then choose "Add to Todoist"
    await waitFor(() => expect(screen.getAllByLabelText("Note actions")[0]).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText("Note actions")[0]);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /add to todoist/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("menuitem", { name: /add to todoist/i }));
    fireEvent.click(screen.getByTestId("fake-add-task"));

    await waitFor(() => expect(archiveNote).toHaveBeenCalledWith(1, true));
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull()); // left the active list
  });

  it("switches to the archived view to surface archived notes", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());
    expect(screen.queryByText("an archived thing")).toBeNull(); // hidden in the active view

    fireEvent.click(screen.getByRole("button", { name: /archived/i }));
    await waitFor(() => expect(screen.getByText("an archived thing")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull()); // active notes leave the archived view
  });

  it("unarchives a note from the archived view (resurfacing it)", async () => {
    const { archiveNote } = await import("../../api.js");
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /archived/i }));
    await waitFor(() => expect(screen.getByText("an archived thing")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull()); // wait out the exit animation so only the archived row remains
    fireEvent.click(screen.getByLabelText("Note actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));

    await waitFor(() => expect(archiveNote).toHaveBeenCalledWith(2, false));
    await waitFor(() => expect(screen.queryByText("an archived thing")).toBeNull()); // left the archived view
  });

  it("deleting shows an undo toast; Undo restores the note and skips the server delete", async () => {
    const { deleteNote } = await import("../../api.js");
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText("Note actions")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull());
    expect(screen.getByText("Note deleted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());
    expect(deleteNote).not.toHaveBeenCalled(); // deferred delete was cancelled
  });

  it("commits a deferred delete on unmount", async () => {
    const { deleteNote } = await import("../../api.js");
    const { unmount } = render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText("Note actions")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull());

    unmount();
    expect(deleteNote).toHaveBeenCalledWith(1);
  });

  describe("batch selection", () => {
    const threeActive = () => {
      getNotes.mockResolvedValue([
        { id: 1, content: "alpha", created_at: "2026-06-18 10:00:00", archived_at: null },
        { id: 2, content: "beta", created_at: "2026-06-18 10:00:00", archived_at: null },
        { id: 3, content: "gamma", created_at: "2026-06-18 10:00:00", archived_at: null },
      ]);
    };

    it("Cmd+click selects notes; bulk Delete removes them, Undo restores (no server delete)", async () => {
      const { deleteNote } = await import("../../api.js");
      threeActive();
      render(<NotesTab accent="#cba6da" />);
      await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());

      fireEvent.click(screen.getByText("alpha"), { metaKey: true });
      fireEvent.click(screen.getByText("beta"), { metaKey: true });
      // right-clicking a selected note opens the bulk menu
      fireEvent.contextMenu(screen.getByText("alpha"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete 2" }));

      await waitFor(() => expect(screen.queryByText("alpha")).toBeNull());
      expect(screen.queryByText("beta")).toBeNull();
      expect(screen.getByText("gamma")).toBeTruthy();         // untouched
      expect(screen.getByText("2 notes deleted")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /undo/i }));
      await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
      expect(screen.getByText("beta")).toBeTruthy();
      expect(deleteNote).not.toHaveBeenCalled();
    });

    it("a plain click clears the selection (conventional deselect)", async () => {
      threeActive();
      render(<NotesTab accent="#cba6da" />);
      await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());

      fireEvent.click(screen.getByText("alpha"), { metaKey: true });
      fireEvent.click(screen.getByText("beta"), { metaKey: true });
      fireEvent.contextMenu(screen.getByText("alpha"));
      await waitFor(() => expect(screen.getByRole("menuitem", { name: "Delete 2" })).toBeTruthy());
      fireEvent.pointerDown(document.body); // close the menu (selection preserved)

      fireEvent.click(screen.getByText("alpha")); // plain click clears the selection
      fireEvent.contextMenu(screen.getByText("alpha"));
      await waitFor(() => expect(screen.getByRole("menuitem", { name: "Edit" })).toBeTruthy()); // single menu is back
      expect(screen.queryByRole("menuitem", { name: /^Delete \d/ })).toBeNull();
    });

    it("Cmd/Ctrl+A selects all visible notes", async () => {
      threeActive();
      render(<NotesTab accent="#cba6da" />);
      await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());

      fireEvent.click(screen.getByText("alpha"), { metaKey: true }); // enter batch mode
      fireEvent.keyDown(window, { key: "a", metaKey: true });

      fireEvent.contextMenu(screen.getByText("gamma"));
      await waitFor(() => expect(screen.getByRole("menuitem", { name: "Delete 3" })).toBeTruthy());
    });
  });

  it("ViewToggle button has sp-focus-ring class for shared focus ring styling", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    const viewToggle = screen.getByRole("button", { name: /^Active/ });
    expect(viewToggle.classList.contains("sp-focus-ring")).toBe(true);
  });

  it("tag chip buttons have sp-focus-ring class for shared focus ring styling", async () => {
    getNotes.mockResolvedValue([
      { id: 1, content: "note with #tag", sort_order: 0, created_at: "2026-06-18 10:00:00", archived_at: null },
    ]);
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByTestId("note-editor")).toBeTruthy());

    const tagChips = screen.getAllByRole("button", { name: /^#/ });
    expect(tagChips.length).toBeGreaterThan(0);
    expect(tagChips[0].classList.contains("sp-focus-ring")).toBe(true);
  });

  it("search input has accessible label via aria-label", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    const searchInput = screen.getByLabelText("Search all notes");
    expect(searchInput).toBeTruthy();
    expect(searchInput.type).toBe("text");
  });
});
