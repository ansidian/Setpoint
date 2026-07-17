import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer";

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
              id: "deadline:todo-done:2026-05-12",
              leadingLabel: "11:59 PM",
              title: "Teamwork Assessment",
              complete: true,
              statusIcon: "complete",
              detailKind: "deadline",
              sourceItem: { id: "todo-done" },
            },
            {
              id: "todoist:todo-done",
              leadingLabel: "11:59 PM",
              title: "Project Deliverables",
              complete: true,
              statusIcon: "complete",
              detailKind: "deadline",
              sourceItem: { id: "todo-done" },
            },
          ],
        }}
        selectedItemId={null}
        onSelectItem={onSelectItem}
      />,
    );

    const chips = screen.getAllByTestId("calendar-cell-item-chip");
    const firstMeta = chips[0]!.querySelector<HTMLElement>("[data-calendar-chip-meta='true']");
    const firstIcon = chips[0]!.querySelector<HTMLElement>("[data-calendar-chip-status-icon='complete']");
    const secondIcon = chips[1]!.querySelector<HTMLElement>("[data-calendar-chip-status-icon='complete']");

    expect(firstMeta?.textContent).toContain("11:59p");
    expect(firstMeta?.style.width).toBe("35px");
    expect(firstMeta?.style.justifyContent).toBe("center");
    expect(firstIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(firstIcon?.closest("s")).toBeNull();
    expect(chips[0]!.textContent).toContain("Teamwork Assessment");
    expect(chips[0]!.querySelector("[data-calendar-chip-title-text='true']")?.closest("s")).toBeTruthy();
    expect(secondIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(chips[1]!.textContent).toContain("Project Deliverables");

    fireEvent.click(chips[1]!);
    expect(onSelectItem).toHaveBeenCalledWith("todoist:todo-done", expect.objectContaining({
      detailKind: "deadline",
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
      .map((chip) => chip.querySelector<HTMLElement>("[data-calendar-chip-title='true']"));

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

    fireEvent.click(chips[1]!);

    expect(document.activeElement).toBe(chips[1]!);
  });

  it("carries a month boundary below adjacent-month inline overflow", () => {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-04-26",
          boundarySides: ["bottom"],
          boundaryColor: "#0095FF",
          items: [
            { id: "event-1", leadingLabel: "10:00 AM", title: "Submit taxes" },
          ],
        }}
        selectedItemId={null}
      />,
    );

    const boundary = screen.getByTestId("calendar-cell-inline-overflow")
      .querySelector<HTMLElement>("[data-calendar-inline-overflow-boundary='bottom']");

    expect(boundary).toBeTruthy();
    expect(boundary!.style.bottom).toBe("0px");
    expect(boundary!.style.background).toBe("#0095FF");
    expect(
      screen.getByTestId("calendar-cell-inline-overflow")
        .querySelector("[data-calendar-inline-overflow-boundary='cross-month']"),
    ).toBeNull();
  });

  it("carries a crossed current-month boundary below inline overflow", () => {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-05-26",
          carryBoundaryToBottom: true,
          boundaryColor: "#0095FF",
          items: [
            { id: "event-1", leadingLabel: "1:00 PM", title: "Return adapter" },
          ],
        }}
        selectedItemId={null}
      />,
    );

    const boundary = screen.getByTestId("calendar-cell-inline-overflow")
      .querySelector<HTMLElement>("[data-calendar-inline-overflow-boundary='bottom']");

    expect(boundary).toBeTruthy();
    expect(boundary!.style.bottom).toBe("0px");
    expect(boundary!.style.background).toBe("#0095FF");
  });
});
