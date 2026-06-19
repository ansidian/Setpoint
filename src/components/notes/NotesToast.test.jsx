import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NotesToast from "./NotesToast.jsx";

describe("NotesToast", () => {
  afterEach(cleanup);

  it("renders nothing without a toast", () => {
    const { container } = render(<NotesToast toast={null} onUndo={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the message and an Undo button that fires onUndo", () => {
    const onUndo = vi.fn();
    render(<NotesToast toast={{ kind: "delete", message: "Note deleted", onUndo: () => {} }} onUndo={onUndo} />);
    expect(screen.getByText("Note deleted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("omits the Undo button when the toast has no onUndo (e.g. an info-only toast)", () => {
    render(<NotesToast toast={{ kind: "archive", message: "Note archived" }} onUndo={() => {}} />);
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });
});
