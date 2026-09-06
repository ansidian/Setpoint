import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
