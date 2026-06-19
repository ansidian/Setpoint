import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NoteContextMenu from "./NoteContextMenu.jsx";

describe("NoteContextMenu", () => {
  afterEach(cleanup); // menu renders into a body portal — unmount it between tests

  const items = (overrides = {}) => ({
    x: 100, y: 100, onClose: vi.fn(),
    onEdit: vi.fn(), onPromote: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(),
    ...overrides,
  });

  it("renders the four actions and fires the chosen one then closes", () => {
    const props = items();
    render(<NoteContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /archive/i }));
    expect(props.onArchive).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const props = items();
    render(<NoteContextMenu {...props} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders Unarchive (not Archive) when onUnarchive is provided and fires it", () => {
    const props = items({ onArchive: undefined, onUnarchive: vi.fn() });
    render(<NoteContextMenu {...props} />);
    // anchored: a plain "Archive" string also substring-matches "Unarchive"
    expect(screen.queryByRole("menuitem", { name: /^Archive$/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Unarchive$/ }));
    expect(props.onUnarchive).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("suffixes bulk action labels with the count", () => {
    const props = items({ onEdit: undefined, onPromote: undefined, count: 3 });
    render(<NoteContextMenu {...props} />);
    expect(screen.getByRole("menuitem", { name: "Archive 3" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete 3" })).toBeTruthy();
  });
});
