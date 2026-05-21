import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotesRail from "./NotesRail";

const mockGetNotes = vi.fn();
const mockCreateNote = vi.fn();
const mockUpdateNote = vi.fn();
const mockDeleteNote = vi.fn();
const mockReorderNotes = vi.fn();

vi.mock("../../api.js", () => ({
  getNotes: (...args) => mockGetNotes(...args),
  createNote: (...args) => mockCreateNote(...args),
  updateNote: (...args) => mockUpdateNote(...args),
  deleteNote: (...args) => mockDeleteNote(...args),
  reorderNotes: (...args) => mockReorderNotes(...args),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }) => <div>{children}</div>,
  arrayMove: (items, from, to) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  },
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => "",
    },
  },
}));

function setScrollHeight(element, value) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value,
  });
}

describe("NotesRail input", () => {
  beforeEach(() => {
    mockGetNotes.mockResolvedValue([]);
    mockCreateNote.mockResolvedValue({ id: "note-1", content: "Long note", sort_order: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("auto-expands the new-note field while capping tall content", () => {
    render(<NotesRail accent="#cba6da" />);

    const input = screen.getByPlaceholderText("Jot something down...");
    setScrollHeight(input, 96);
    fireEvent.change(input, { target: { value: "A longer note that wraps across a few lines" } });

    expect(input.style.height).toBe("72px");
    expect(input.style.overflowY).toBe("auto");

    setScrollHeight(input, 220);
    fireEvent.change(input, { target: { value: "A much longer note\nwith several lines\nand more content" } });

    expect(input.style.height).toBe("72px");
    expect(input.style.overflowY).toBe("auto");
  });

  it("creates on Enter and preserves Shift+Enter for multiline input", async () => {
    render(<NotesRail accent="#cba6da" />);

    const input = screen.getByPlaceholderText("Jot something down...");
    fireEvent.change(input, { target: { value: "Line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(mockCreateNote).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockCreateNote).toHaveBeenCalledWith("Line one");
    });
    expect(input.value).toBe("");
  });

  it("renders a bounded dashboard preview when many notes exist", async () => {
    mockGetNotes.mockResolvedValue([
      { id: "note-1", content: "First note", sort_order: 0 },
      { id: "note-2", content: "Second note", sort_order: 1 },
      { id: "note-3", content: "Third note", sort_order: 2 },
      { id: "note-4", content: "Fourth note", sort_order: 3 },
    ]);

    render(<NotesRail accent="#cba6da" />);

    expect(await screen.findByText("First note")).toBeTruthy();
    expect(screen.getByText("Third note")).toBeTruthy();
    expect(screen.queryByText("Fourth note")).toBeNull();
    expect(screen.getByText("+1 more")).toBeTruthy();
  });
});
