import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NoteContextMenu from "./NoteContextMenu.jsx";

describe("NoteContextMenu", () => {
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
});
