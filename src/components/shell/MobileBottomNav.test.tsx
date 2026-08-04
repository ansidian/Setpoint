import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MobileBottomNav } from "./MobileBottomNav";
import type { DashboardTab } from "../dashboard/dashboardShellModel";

function NavHarness({ initialTab = "dashboard" }: { initialTab?: DashboardTab }) {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  return <MobileBottomNav tab={tab} onTab={setTab} inboxUnreadSignalCount={0} />;
}

afterEach(cleanup);

describe("MobileBottomNav", () => {
  it("renders the four mobile tabs in order, including calendar", () => {
    render(<MobileBottomNav tab="dashboard" onTab={() => {}} inboxUnreadSignalCount={0} />);
    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Dashboard", "Inbox", "Calendar", "Notes"]);
  });

  it("selects Calendar when its tab is tapped", () => {
    render(<NavHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(screen.getByRole("button", { name: "Calendar" }).getAttribute("aria-current")).toBe("page");
  });

  it("marks the active tab with aria-current and moves selection to another tab", () => {
    render(<NavHarness initialTab="inbox" />);
    expect(screen.getByRole("button", { name: "Inbox" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-current")).toBe("page");
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
