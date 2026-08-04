import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import TransactionImportDateField from "./TransactionImportDateField";

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TransactionImportDateField", () => {
  it("uses the shared calendar picker and returns a YMD date", () => {
    function Harness() {
      const [value, setValue] = useState("2026-07-01");
      return <TransactionImportDateField value={value} onChange={setValue} ariaLabel="Start date" />;
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Start date" }));
    const picker = screen.getByRole("dialog", { name: "Start date picker" });
    fireEvent.click(within(picker).getByRole("button", { name: "14" }));
    fireEvent.click(within(picker).getByRole("button", { name: "Choose date" }));

    expect(screen.getByRole("button", { name: "Start date" }).textContent).toContain("Jul 14, 2026");
  });

  it("stays closed when disabled", () => {
    render(
      <TransactionImportDateField
        value="2026-07-01"
        onChange={vi.fn()}
        ariaLabel="End date"
        disabled
      />,
    );

    const trigger = screen.getByRole("button", { name: "End date" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog", { name: "End date picker" })).toBeNull();
  });
});
