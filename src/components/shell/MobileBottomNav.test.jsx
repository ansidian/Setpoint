import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileBottomNav } from "./MobileBottomNav.jsx";

afterEach(cleanup);

describe("MobileBottomNav", () => {
  it("renders exactly the three mobile tabs in order, with no calendar", () => {
    render(<MobileBottomNav tab="dashboard" onTab={() => {}} inboxUnreadSignalCount={0} />);
    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Dashboard", "Inbox", "Notes"]);
  });

  it("marks the active tab with aria-current and fires onTab with the tab key", () => {
    const onTab = vi.fn();
    render(<MobileBottomNav tab="inbox" onTab={onTab} inboxUnreadSignalCount={0} />);
    expect(screen.getByRole("button", { name: "Inbox" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(onTab).toHaveBeenCalledWith("notes");
  });

  it("shows the inbox unread badge only when count > 0 and clamps > 99 to 99+", () => {
    const { rerender } = render(
      <MobileBottomNav tab="dashboard" onTab={() => {}} inboxUnreadSignalCount={0} />,
    );
    expect(screen.queryByTitle(/unread/)).toBeNull();
    rerender(<MobileBottomNav tab="dashboard" onTab={() => {}} inboxUnreadSignalCount={150} />);
    expect(screen.getByTitle("150 unread").textContent).toBe("99+");
  });
});
