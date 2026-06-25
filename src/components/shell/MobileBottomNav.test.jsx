import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileBottomNav } from "./MobileBottomNav.jsx";

afterEach(cleanup);

describe("MobileBottomNav", () => {
  it("renders the four mobile tabs in order, including calendar", () => {
    render(<MobileBottomNav tab="dashboard" onTab={() => {}} inboxUnreadSignalCount={0} />);
    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Dashboard", "Inbox", "Calendar", "Notes"]);
  });

  it("fires onTab('calendar') when the Calendar tab is tapped", () => {
    const onTab = vi.fn();
    render(<MobileBottomNav tab="dashboard" onTab={onTab} inboxUnreadSignalCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(onTab).toHaveBeenCalledWith("calendar");
  });

  it("marks the active tab with aria-current and fires onTab with the tab key", () => {
    const onTab = vi.fn();
    render(<MobileBottomNav tab="inbox" onTab={onTab} inboxUnreadSignalCount={0} />);
    expect(screen.getByRole("button", { name: "Inbox" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(onTab).toHaveBeenCalledWith("notes");
  });

  it("fires onRetap (not onTab) when the active tab is re-tapped", () => {
    const onTab = vi.fn();
    const onRetap = vi.fn();
    render(<MobileBottomNav tab="calendar" onTab={onTab} onRetap={onRetap} inboxUnreadSignalCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(onRetap).toHaveBeenCalledWith("calendar");
    expect(onTab).not.toHaveBeenCalled();
  });

  it("still fires onTab for a non-active tab even when onRetap is provided", () => {
    const onTab = vi.fn();
    const onRetap = vi.fn();
    render(<MobileBottomNav tab="calendar" onTab={onTab} onRetap={onRetap} inboxUnreadSignalCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(onTab).toHaveBeenCalledWith("dashboard");
    expect(onRetap).not.toHaveBeenCalled();
  });

  it("falls back to onTab when the active tab is re-tapped without onRetap", () => {
    const onTab = vi.fn();
    render(<MobileBottomNav tab="calendar" onTab={onTab} inboxUnreadSignalCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(onTab).toHaveBeenCalledWith("calendar");
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
