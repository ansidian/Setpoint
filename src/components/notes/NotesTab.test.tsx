import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import NotesTab from "./NotesTab";
import { invalidateTodoistReferenceCache } from "../todoist/add-task-panel/todoistReferenceCache";
import type { Note } from "../../../shared/types/notes";

interface RequestRecord { path: string; method: string; body: unknown }
let notes: Note[] = [];
let requests: RequestRecord[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("NotesTab", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    invalidateTodoistReferenceCache();
    requests = [];
    notes = [
      { id: 1, user_id: "test", content: "active note one", sort_order: 0, created_at: "2026-06-18 10:00:00", archived_at: null },
      { id: 2, user_id: "test", content: "an archived thing", sort_order: 1, created_at: "2026-06-01 10:00:00", archived_at: "2026-06-02 10:00:00" },
    ];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "https://setpoint.test");
      const record = { path: url.pathname, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null };
      requests.push(record);
      if (url.pathname === "/api/notes" && record.method === "GET") return json(notes);
      if (url.pathname === "/api/briefing/todoist/projects" || url.pathname === "/api/briefing/todoist/labels") return json([]);
      if (url.pathname === "/api/ea/reminders") return json(record.method === "GET" ? { reminders: [] } : { reminder: { id: "rem-created" } });
      if (url.pathname === "/api/calendar/deadlines" && record.method === "POST") {
        const body = record.body as { content?: string; title?: string } | null;
        return json({ id: "todo-new", content: body?.content ?? body?.title ?? "active note one" });
      }
      return json({ success: true });
    });
  });

  it("shows active notes and hides archived ones by default", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());
    expect(screen.queryByText("an archived thing")).toBeNull();
    expect(screen.getByRole("textbox", { name: "New note" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/search/i)).toBeTruthy();
  });

  it("does not autofocus the capture field on entry", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());
    const capture = screen.getByRole("textbox", { name: "New note" });
    expect(document.activeElement).not.toBe(capture);
  });

  it("promotes a note to a task and auto-archives it", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    // open the row's action menu, then choose "Add to Todoist"
    await waitFor(() => expect(screen.getAllByLabelText("Note actions")[0]).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText("Note actions")[0]!);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /add to todoist/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("menuitem", { name: /add to todoist/i }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Task title" }).value).toBe("active note one");
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(requests).toContainEqual({ path: "/api/notes/1/archive", method: "PATCH", body: { archived: true } }));
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
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /archived/i }));
    await waitFor(() => expect(screen.getByText("an archived thing")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull()); // wait out the exit animation so only the archived row remains
    fireEvent.click(screen.getByLabelText("Note actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));

    await waitFor(() => expect(requests).toContainEqual({ path: "/api/notes/2/archive", method: "PATCH", body: { archived: false } }));
    await waitFor(() => expect(screen.queryByText("an archived thing")).toBeNull()); // left the archived view
  });

  it("deleting shows an undo toast; Undo restores the note and skips the server delete", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText("Note actions")[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull());
    expect(screen.getByText("Note deleted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());
    expect(requests.some((request) => request.path === "/api/notes/1" && request.method === "DELETE")).toBe(false);
  });

  it("commits a deferred delete on unmount", async () => {
    const { unmount } = render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText("Note actions")[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("active note one")).toBeNull());

    unmount();
    expect(requests).toContainEqual({ path: "/api/notes/1", method: "DELETE", body: null });
  });

  describe("batch selection", () => {
    const threeActive = () => {
      notes = [
        { id: 1, user_id: "test", content: "alpha", sort_order: 0, created_at: "2026-06-18 10:00:00", archived_at: null },
        { id: 2, user_id: "test", content: "beta", sort_order: 1, created_at: "2026-06-18 10:00:00", archived_at: null },
        { id: 3, user_id: "test", content: "gamma", sort_order: 2, created_at: "2026-06-18 10:00:00", archived_at: null },
      ];
    };

    it("Cmd+click selects notes; bulk Delete removes them, Undo restores (no server delete)", async () => {
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
      expect(requests.some((request) => request.method === "DELETE")).toBe(false);
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

  it("search input has accessible label via aria-label", async () => {
    render(<NotesTab accent="#cba6da" />);
    await waitFor(() => expect(screen.getByText("active note one")).toBeTruthy());

    const searchInput = screen.getByLabelText<HTMLInputElement>("Search all notes");
    expect(searchInput).toBeTruthy();
    expect(searchInput.type).toBe("text");
  });
});
