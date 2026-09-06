import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef, useState } from "react";
import BillDueField from "./BillDueField";

function FieldHarness({ initialDue = "" }: { initialDue?: string } = {}) {
  const [editDue, setEditDue] = useState(initialDue);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    rootRef.current.getBoundingClientRect = () => ({
      left: 140,
      top: 120,
      right: 260,
      bottom: 156,
      width: 120,
      height: 36,
      x: 140,
      y: 120,
      toJSON: () => ({}),
    });
  }, []);

  return (
    <div>
      <div ref={rootRef}>
        <BillDueField editDue={editDue} setEditDue={setEditDue} />
      </div>
      <div data-testid="due-value">{editDue}</div>
    </div>
  );
}

describe("BillDueField", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T17:00:10.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("still allows selecting an overdue date", () => {
    render(<FieldHarness initialDue="2026-04-21" />);

    fireEvent.click(screen.getByRole("button", { name: "Set bill due date" }));

    const picker = screen.getByRole("dialog", { name: "Bill due date picker" });
    fireEvent.click(within(picker).getByRole("button", { name: "18" }));
    fireEvent.click(within(picker).getByRole("button", { name: "Set due date" }));

    expect(screen.getByTestId("due-value").textContent).toBe("2026-04-18");
  });
});
