import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellTabs } from "./ShellTabs.jsx";

function renderTabs(overrides = {}) {
  const onTab = vi.fn();
  const utils = render(
    <ShellTabs tab="dashboard" onTab={onTab} inboxUnreadSignalCount={0} {...overrides} />,
  );
  return { onTab, ...utils };
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
    const { onTab } = renderTabs({ tab: "dashboard" });

    const dashboardTab = screen.getByRole("tab", { name: /Dashboard/ });
    dashboardTab.focus();
    fireEvent.keyDown(dashboardTab, { key: "ArrowRight" });

    expect(onTab).toHaveBeenCalledWith("inbox");
  });

  it("ArrowLeft from the first tab wraps to the last tab", () => {
    const { onTab } = renderTabs({ tab: "dashboard" });

    const dashboardTab = screen.getByRole("tab", { name: /Dashboard/ });
    dashboardTab.focus();
    fireEvent.keyDown(dashboardTab, { key: "ArrowLeft" });

    expect(onTab).toHaveBeenCalledWith("news");
  });

  it("Home and End jump to the first and last tab", () => {
    const { onTab } = renderTabs({ tab: "calendar" });

    const calendarTab = screen.getByRole("tab", { name: /Calendar/ });
    calendarTab.focus();
    fireEvent.keyDown(calendarTab, { key: "End" });
    expect(onTab).toHaveBeenLastCalledWith("news");

    fireEvent.keyDown(calendarTab, { key: "Home" });
    expect(onTab).toHaveBeenLastCalledWith("dashboard");
  });

  it("moves DOM focus to the newly-activated tab button", () => {
    renderTabs({ tab: "dashboard" });

    const dashboardTab = screen.getByRole("tab", { name: /Dashboard/ });
    dashboardTab.focus();
    fireEvent.keyDown(dashboardTab, { key: "ArrowRight" });

    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Inbox/ }));
  });

  it("applies sp-focus-ring class to all tab buttons for shared focus-ring styling", () => {
    renderTabs();

    const tabs = screen.getAllByRole("tab");
    for (const tab of tabs) {
      expect(tab.classList.contains("sp-focus-ring")).toBe(true);
    }
  });
});
