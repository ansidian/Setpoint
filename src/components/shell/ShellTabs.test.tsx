import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShellTabs } from "./ShellTabs";
import type { DashboardTab } from "../dashboard/dashboardShellModel";

function TabsHarness({ initialTab = "dashboard" }: { initialTab?: DashboardTab }) {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  return <ShellTabs tab={tab} onTab={setTab} inboxUnreadSignalCount={0} />;
}

function renderTabs({ tab = "dashboard" }: { tab?: DashboardTab } = {}) {
  return render(<TabsHarness initialTab={tab} />);
}

describe("ShellTabs WAI-ARIA tabs pattern", () => {
  afterEach(cleanup);

  it("exposes a tablist with 5 tabs, one selected", () => {
    renderTabs();

    const tablist = screen.getByRole("tablist", { name: "Primary" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(5);

    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(screen.getByRole("tab", { name: /Dashboard/ }));
  });

  it("gives the active tab tabIndex 0 and every other tab tabIndex -1", () => {
    renderTabs({ tab: "inbox" });

    const tabs = screen.getAllByRole("tab");
    for (const tab of tabs) {
      const isInbox = /Inbox/.test(tab.textContent);
      expect(tab.tabIndex).toBe(isInbox ? 0 : -1);
    }
  });

  it("wires id/aria-controls per tab so a matching tabpanel can be linked", () => {
    renderTabs();

    const dashboardTab = screen.getByRole("tab", { name: /Dashboard/ });
    expect(dashboardTab.id).toBe("shell-tab-dashboard");
    expect(dashboardTab.getAttribute("aria-controls")).toBe("shell-tabpanel-dashboard");

    const inboxTab = screen.getByRole("tab", { name: /Inbox/ });
    expect(inboxTab.id).toBe("shell-tab-inbox");
    expect(inboxTab.getAttribute("aria-controls")).toBe("shell-tabpanel-inbox");
  });

  it("ArrowRight moves focus and activates the next tab (activation-follows-focus)", () => {
    renderTabs({ tab: "dashboard" });

    const dashboardTab = screen.getByRole("tab", { name: /Dashboard/ });
    dashboardTab.focus();
    fireEvent.keyDown(dashboardTab, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: /Inbox/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("ArrowLeft from the first tab wraps to the last tab", () => {
    renderTabs({ tab: "dashboard" });

    const dashboardTab = screen.getByRole("tab", { name: /Dashboard/ });
    dashboardTab.focus();
    fireEvent.keyDown(dashboardTab, { key: "ArrowLeft" });

    expect(screen.getByRole("tab", { name: /News/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("Home and End jump to the first and last tab", () => {
    renderTabs({ tab: "calendar" });

    const calendarTab = screen.getByRole("tab", { name: /Calendar/ });
    calendarTab.focus();
    fireEvent.keyDown(calendarTab, { key: "End" });
    expect(screen.getByRole("tab", { name: /News/ }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(screen.getByRole("tab", { name: /News/ }), { key: "Home" });
    expect(screen.getByRole("tab", { name: /Dashboard/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("moves DOM focus to the newly-activated tab button", () => {
    renderTabs({ tab: "dashboard" });

    const dashboardTab = screen.getByRole("tab", { name: /Dashboard/ });
    dashboardTab.focus();
    fireEvent.keyDown(dashboardTab, { key: "ArrowRight" });

    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Inbox/ }));
  });
});
