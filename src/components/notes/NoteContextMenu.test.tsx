import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NoteContextMenu from "./NoteContextMenu";
import type { NoteContextMenuProps } from "./NoteContextMenu";

describe("NoteContextMenu", () => {
  afterEach(cleanup); // menu renders into a body portal — unmount it between tests

  function MenuHarness({ unarchive = false, count }: { unarchive?: boolean; count?: number }) {
    const [open, setOpen] = useState(true);
    const [action, setAction] = useState("none");
    const actionProps: Partial<NoteContextMenuProps> = unarchive
      ? { onUnarchive: () => setAction("unarchived") }
      : { onArchive: () => setAction("archived") };
    return <>
      {open ? <NoteContextMenu x={100} y={100} onClose={() => setOpen(false)}
        onEdit={() => setAction("edited")} onPromote={() => setAction("promoted")}
        onDelete={() => setAction("deleted")} count={count} {...actionProps} /> : null}
      <output>{`${action}:${open ? "open" : "closed"}`}</output>
    </>;
  }

  it("renders the four actions and fires the chosen one then closes", () => {
    render(<MenuHarness />);
    fireEvent.click(screen.getByRole("menuitem", { name: /archive/i }));
    expect(screen.getByText("archived:closed")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape", () => {
    render(<MenuHarness />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("none:closed")).toBeTruthy();
  });

  it("renders Unarchive (not Archive) when onUnarchive is provided and fires it", () => {
    render(<MenuHarness unarchive />);
    // anchored: a plain "Archive" string also substring-matches "Unarchive"
    expect(screen.queryByRole("menuitem", { name: /^Archive$/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Unarchive$/ }));
    expect(screen.getByText("unarchived:closed")).toBeTruthy();
  });

  it("suffixes bulk action labels with the count", () => {
    render(<MenuHarness count={3} />);
    expect(screen.getByRole("menuitem", { name: "Archive 3" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete 3" })).toBeTruthy();
  });
});
