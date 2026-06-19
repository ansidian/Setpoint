import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { StrictMode } from "react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import NoteItem from "./NoteItem.jsx";

// NoteItem mounts the real CodeMirror NoteEditor for inline edit. These tests run
// under <StrictMode> on purpose: the "editing auto-cancels before I can edit" bug
// only manifests under StrictMode's mount->cleanup->mount double-invoke, where
// view.destroy() blurs the just-focused editor.
const NOTE = { id: 1, content: "buy milk and eggs", created_at: "2026-06-18 10:00:00", archived_at: null };

function renderItem(overrides = {}) {
  const props = {
    note: NOTE,
    accent: "#cba6da",
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onArchive: vi.fn(),
    onPromote: vi.fn(),
    tags: [],
    age: "1d",
    ...overrides,
  };
  const utils = render(
    <StrictMode>
      <DndContext>
        <SortableContext items={[props.note.id]}>
          <NoteItem {...props} />
        </SortableContext>
      </DndContext>
    </StrictMode>,
  );
  return { ...utils, props };
}

describe("NoteItem inline edit", () => {
  afterEach(cleanup);

  it("stays in edit mode after opening edit via the context menu", () => {
    const { container } = renderItem();
    fireEvent.click(screen.getByLabelText("Note actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: /edit/i }));
    // With the teardown-blur bug, editing would immediately flip back to the read
    // view and the editor would be gone. The guard keeps it mounted.
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });

  it("stays in edit mode after entering edit via double-click", () => {
    const { container } = renderItem();
    fireEvent.dblClick(screen.getByText(/buy milk and eggs/i));
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });

  it("shows the read view (not an editor) at rest", () => {
    const { container } = renderItem();
    expect(container.querySelector(".cm-editor")).toBeNull();
    expect(screen.getByText(/buy milk and eggs/i)).toBeTruthy();
  });

  it("renders the note's age", () => {
    renderItem({ age: "3w" });
    expect(within(document.body).getByText("3w")).toBeTruthy();
  });

  it("surfaces #tags as footer chips and strips them from the body text", () => {
    renderItem({ note: { id: 2, content: "Renew the domain #admin", created_at: "2026-06-18 10:00:00" } });
    expect(screen.getByText("#admin")).toBeTruthy();        // footer chip
    expect(screen.getByText("Renew the domain")).toBeTruthy(); // body, tag stripped
  });

  it("shows an 'edited' label when updated_at is well after created_at", () => {
    renderItem({ note: { id: 3, content: "tweaked note", created_at: "2026-06-01 10:00:00", updated_at: "2026-06-18T10:00:00.000Z" } });
    expect(screen.getByText(/edited/i)).toBeTruthy();
  });

  it("shows no 'edited' label for a freshly created note", () => {
    renderItem({ note: { id: 4, content: "brand new", created_at: "2026-06-18 10:00:00", updated_at: "2026-06-18T10:00:20.000Z" } });
    expect(screen.queryByText(/edited/i)).toBeNull();
  });
});
