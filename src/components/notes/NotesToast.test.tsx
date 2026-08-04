import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import NotesToast from "./NotesToast";

describe("NotesToast", () => {
  afterEach(cleanup);

  it("renders nothing without a toast", () => {
    const { container } = render(<NotesToast toast={null} onUndo={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the message and an Undo button for a reversible toast", () => {
    render(<NotesToast toast={{ id: "delete-1", kind: "delete", message: "Note deleted", onUndo: () => {} }} onUndo={() => {}} />);
    expect(screen.getByText("Note deleted")).toBeTruthy();
    expect(screen.getByRole("button", { name: /undo/i })).toBeTruthy();
  });

  it("omits the Undo button when the toast has no onUndo (e.g. an info-only toast)", () => {
    render(<NotesToast toast={{ id: "archive-1", kind: "archive", message: "Note archived" }} onUndo={() => {}} />);
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });
});
