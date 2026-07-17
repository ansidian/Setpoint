import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import MobileFilterSheet from "./MobileFilterSheet";

afterEach(() => cleanup());

const accounts = [
  { id: "work", name: "Work", email: "work@example.com", color: "#89b4fa", unread: 3 },
  { id: "personal", name: "Personal", email: "me@example.com", color: "#a6e3a1", unread: 1 },
];

function renderSheet(props: Partial<ComponentProps<typeof MobileFilterSheet>> = {}) {
  return render(
    <MobileFilterSheet
      open
      accent="#cba6da"
      accountId="__all"
      setAccountId={vi.fn()}
      accounts={accounts}
      totalUnread={4}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

describe("MobileFilterSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByTestId("inbox-mobile-filter-sheet")).toBeNull();
  });

  it("lists every account plus an all-accounts option", () => {
    renderSheet();
    expect(screen.getByTestId("inbox-mobile-filter-sheet")).toBeTruthy();
    expect(screen.getByText("All accounts")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
  });

  it("selects an account and closes", () => {
    const setAccountId = vi.fn();
    const onClose = vi.fn();
    renderSheet({ setAccountId, onClose });
    fireEvent.click(screen.getByText("Work"));
    expect(setAccountId).toHaveBeenCalledWith("work");
    expect(onClose).toHaveBeenCalled();
  });
});
