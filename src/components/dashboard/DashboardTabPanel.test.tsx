import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DashboardTabPanel from "./DashboardTabPanel";

afterEach(cleanup);

function PanelProbe({ isMobile = false }: { isMobile?: boolean }) {
  const [tab, setTab] = useState<"dashboard" | "inbox">("dashboard");
  return (
    <>
      <button type="button" id="shell-tab-dashboard" onClick={() => setTab("dashboard")}>Dashboard</button>
      <button type="button" id="shell-tab-inbox" onClick={() => setTab("inbox")}>Inbox</button>
      <DashboardTabPanel tab="dashboard" active={tab === "dashboard"} isMobile={isMobile}>Dashboard content</DashboardTabPanel>
      <DashboardTabPanel tab="inbox" active={tab === "inbox"} isMobile={isMobile}>Inbox content</DashboardTabPanel>
    </>
  );
}

describe("DashboardTabPanel", () => {
  it("keeps only the active desktop panel in the accessibility tree and links it to its tab", () => {
    render(<PanelProbe />);
    const dashboardPanel = screen.getByRole("tabpanel", { name: "Dashboard" });
    expect(dashboardPanel.id).toBe("shell-tabpanel-dashboard");
    expect(dashboardPanel.getAttribute("aria-labelledby")).toBe("shell-tab-dashboard");

    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));

    const inboxPanel = screen.getByRole("tabpanel", { name: "Inbox" });
    expect(inboxPanel.id).toBe("shell-tabpanel-inbox");
    expect(inboxPanel.getAttribute("aria-labelledby")).toBe("shell-tab-inbox");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("uses a direct accessible name on mobile where desktop tabs are absent", () => {
    render(<DashboardTabPanel tab="dashboard" active isMobile>Dashboard content</DashboardTabPanel>);
    const panel = screen.getByRole("tabpanel", { name: "Dashboard" });
    expect(panel.getAttribute("aria-label")).toBe("Dashboard");
    expect(panel.hasAttribute("aria-labelledby")).toBe(false);
  });
});
