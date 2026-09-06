import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarModalHeader from "./CalendarModalHeader.tsx";

afterEach(cleanup);

function renderHeader({
  view = "events",
  availableCalendarViews = ["events", "bills"],
}: {
  view?: string;
  availableCalendarViews?: string[];
} = {}) {
  function HeaderHarness() {
    const [activeView, setActiveView] = useState(view);
    return (
      <CalendarModalHeader
        view={activeView}
        monthName="April"
        monthYear={2026}
        layout={{ tier: "xl", shellPadding: 24, contentGap: 12 }}
        canGoPrev
        navigateMonth={vi.fn()}
        jumpToMonth={vi.fn()}
        currentYear={2026}
        currentMonth={3}
        onViewChange={setActiveView}
        availableCalendarViews={availableCalendarViews}
        eventEditor={{} as never}
        viewYear={2026}
        viewMonth={3}
        setDeadlineEditor={vi.fn()}
        viewLabel="Events"
      />
    );
  }

  render(
    <HeaderHarness />,
  );
}

function selectedTab(name: string) {
  return screen.getByRole("tab", { name }).getAttribute("aria-selected");
}

describe("CalendarModalHeader tablist", () => {

  it("ArrowRight on a focused tab moves selection", () => {
    renderHeader();

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    fireEvent.keyDown(list, { key: "ArrowRight" });

    expect(selectedTab("Bills")).toBe("true");
  });

  it("ArrowLeft on a focused tab moves selection", () => {
    renderHeader({ view: "bills" });

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    fireEvent.keyDown(list, { key: "ArrowLeft" });

    expect(selectedTab("Events")).toBe("true");
  });

  it("Home key moves to first view when not already first", () => {
    renderHeader({ view: "bills" });

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    fireEvent.keyDown(list, { key: "Home" });
    expect(selectedTab("Events")).toBe("true");
  });

  it("End key moves to last view when not already last", () => {
    renderHeader();

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    fireEvent.keyDown(list, { key: "End" });
    expect(selectedTab("Bills")).toBe("true");
  });
});
