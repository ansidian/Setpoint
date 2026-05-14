import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer.jsx";

afterEach(() => {
  cleanup();
});

describe("CalendarInlineOverflowLayer", () => {
  it("keeps compact time labels visible and renders deadline status icons", () => {
    const onSelectItem = vi.fn();
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-05-12",
          leadingColumnWidth: 35,
          items: [
            {
              id: "canvas:ctm-done",
              leadingLabel: "11:59 PM",
              title: "Teamwork Assessment",
              complete: true,
              statusIcon: "complete",
              detailView: "deadlines",
              sourceItem: { id: "ctm-done" },
            },
            {
              id: "todoist:todo-done",
              leadingLabel: "11:59 PM",
              title: "Project Deliverables",
              complete: true,
              statusIcon: "complete",
              detailView: "deadlines",
              sourceItem: { id: "todo-done" },
            },
          ],
        }}
        selectedItemId={null}
        onSelectItem={onSelectItem}
      />,
    );

    const chips = screen.getAllByTestId("calendar-cell-item-chip");
    const firstMeta = chips[0].querySelector("[data-calendar-chip-meta='true']");
    const firstIcon = chips[0].querySelector("[data-calendar-chip-status-icon='complete']");
    const secondIcon = chips[1].querySelector("[data-calendar-chip-status-icon='complete']");

    expect(firstMeta?.textContent).toContain("11:59p");
    expect(firstMeta?.style.width).toBe("35px");
    expect(firstMeta?.style.justifyContent).toBe("center");
    expect(firstIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(firstIcon?.closest("s")).toBeNull();
    expect(chips[0].textContent).toContain("Teamwork Assessment");
    expect(chips[0].querySelector("[data-calendar-chip-title-text='true']")?.closest("s")).toBeTruthy();
    expect(secondIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(chips[1].textContent).toContain("Project Deliverables");

    fireEvent.click(chips[1]);
    expect(onSelectItem).toHaveBeenCalledWith("todoist:todo-done", expect.objectContaining({
      detailView: "deadlines",
      dateKey: "2026-05-12",
    }));
  });

  it("keeps selected inline overflow title metrics stable", () => {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-05-12",
          leadingColumnWidth: 35,
          items: [
            {
              id: "event-plain",
              leadingLabel: "9:00 AM",
              title: "Advanced machine learning project review and lab planning",
            },
            {
              id: "event-selected",
              leadingLabel: "9:00 AM",
              title: "Advanced machine learning project review and lab planning",
            },
          ],
        }}
        selectedItemId="event-selected"
      />,
    );

    const titles = screen
      .getAllByTestId("calendar-cell-item-chip")
      .map((chip) => chip.querySelector("[data-calendar-chip-title='true']"));

    expect(titles[0]?.getAttribute("data-calendar-chip-title-fit")).toBe(
      titles[1]?.getAttribute("data-calendar-chip-title-fit"),
    );
    expect(titles[0]?.style.fontWeight).toBe(titles[1]?.style.fontWeight);
  });

  it("moves focus to the clicked hidden item", () => {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-05-12",
          items: [
            { id: "event-1", leadingLabel: "9:00 AM", title: "Check-in" },
            { id: "event-2", leadingLabel: "5:30 PM", title: "Wash Car" },
          ],
        }}
        selectedItemId={null}
        onSelectItem={vi.fn()}
      />,
    );

    const chips = screen.getAllByTestId("calendar-cell-item-chip");

    fireEvent.click(chips[1]);

    expect(document.activeElement).toBe(chips[1]);
  });
});
