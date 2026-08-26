// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, type Editor } from "tldraw";
import { ChecklistShapeCard } from "./ChecklistShapeCard";
import type { ChecklistShape } from "./checklistShapeModel";

vi.mock("tldraw", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    HTMLContainer: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  };
});

afterEach(cleanup);

function rect(top: number, height = 32): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 300,
    bottom: top + height,
    width: 300,
    height,
    toJSON: () => ({}),
  };
}

function ChecklistHarness() {
  const [commitCount, setCommitCount] = useState(0);
  const [shape, setShape] = useState({
    id: "shape:checklist",
    type: "setpoint-checklist",
    props: {
      w: 320,
      h: 220,
      color: "black",
      font: "draw",
      size: "m",
      title: "Plan",
      items: [
        { id: "first", text: "First", checked: false },
        { id: "second", text: "Second", checked: false },
      ],
    },
  } as ChecklistShape);
  const editor = {
    updateShape: (update: { props?: Partial<ChecklistShape["props"]> }) => {
      setShape((current) => ({
        ...current,
        props: { ...current.props, ...update.props },
      }));
      setCommitCount((count) => count + 1);
    },
    markHistoryStoppingPoint: () => undefined,
    getCurrentTheme: () => DEFAULT_THEME,
    getColorMode: () => "dark",
  } as unknown as Editor;

  return (
    <>
      <output data-testid="commit-count">{commitCount}</output>
      <ChecklistShapeCard editor={editor} shape={shape} />
    </>
  );
}

function CompletedChecklistHarness() {
  const [historyLabel, setHistoryLabel] = useState("");
  const [shape, setShape] = useState({
    id: "shape:checklist-completed",
    type: "setpoint-checklist",
    props: {
      w: 320,
      h: 260,
      color: "black",
      font: "draw",
      size: "m",
      title: "Plan",
      items: [
        { id: "first", text: "Done", checked: true },
        { id: "second", text: "Next", checked: false },
        { id: "third", text: "Also done", checked: true },
      ],
    },
  } as ChecklistShape);
  const editor = {
    updateShape: (update: { props?: Partial<ChecklistShape["props"]> }) => {
      setShape((current) => ({
        ...current,
        props: { ...current.props, ...update.props },
      }));
    },
    markHistoryStoppingPoint: (label: string) => setHistoryLabel(label),
    getCurrentTheme: () => DEFAULT_THEME,
    getColorMode: () => "dark",
  } as unknown as Editor;

  return (
    <>
      <output data-testid="history-label">{historyLabel}</output>
      <ChecklistShapeCard editor={editor} shape={shape} />
    </>
  );
}

describe("ChecklistShapeCard", () => {
  it("clears all completed items in one undoable action", () => {
    render(<CompletedChecklistHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Clear 2 completed items" }));

    expect(screen.getAllByRole("textbox", { name: "Checklist item" }).map((element) => (
      element as HTMLTextAreaElement
    ).value)).toEqual(["Next"]);
    expect(screen.queryByRole("button", { name: /Clear \d+ completed/ })).toBeNull();
    expect(screen.getByTestId("history-label").textContent).toBe("remove completed checklist items");
  });

  it("finishes reordering when the pointer is released outside the moving grip", () => {
    render(<ChecklistHarness />);
    const firstGrip = screen.getByRole("button", { name: /Reorder First/i });
    const rows = screen.getAllByRole("listitem");
    rows[0]!.getBoundingClientRect = () => rect(0);
    rows[1]!.getBoundingClientRect = () => rect(40);

    fireEvent.pointerDown(firstGrip, { pointerId: 1, clientY: 10 });
    fireEvent.pointerMove(firstGrip, { pointerId: 1, clientY: 62 });

    expect(screen.getByTestId("commit-count").textContent).toBe("0");

    fireEvent.pointerUp(window, { pointerId: 1, clientY: 62 });

    expect(screen.getByTestId("commit-count").textContent).toBe("1");
    expect(screen.getAllByRole("textbox", { name: "Checklist item" }).map((element) => (
      element as HTMLTextAreaElement
    ).value)).toEqual(["Second", "First"]);
  });
});
