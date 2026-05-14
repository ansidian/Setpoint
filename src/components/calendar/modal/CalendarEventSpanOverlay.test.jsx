import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarEventSpanOverlay from "./CalendarEventSpanOverlay.jsx";
import { getChipLeadingColumnWidth } from "./CalendarCellItemChipModel.js";

afterEach(() => {
  cleanup();
});

describe("CalendarEventSpanOverlay", () => {
  it("keeps spanning event ghost chip time labels in a stable leading column", () => {
    render(
      <CalendarEventSpanOverlay
        segments={[{
          id: "ghost:event-1:2026-04-20:2026-04-22",
          kind: "ghost",
          row: 1,
          columnStart: 2,
          columnEnd: 5,
          lane: 0,
          segmentStart: "2026-04-20",
          segmentEnd: "2026-04-22",
          item: {
            id: "event-ghost",
            kind: "event",
            title: "Check-in IHSS",
            startDate: "2026-04-20",
            endDate: "2026-04-22",
            startTime: "13:00",
            color: "#89b4fa",
          },
        }]}
        layout={{ cellHeight: 120, gridGap: 4, tier: "lg" }}
        gridRowCount={6}
      />,
    );

    const ghost = screen.getByTestId("calendar-ghost-chip");
    const meta = ghost.querySelector("[data-calendar-span-meta='true']");
    const content = ghost.querySelector("[data-calendar-span-title-fit]");

    expect(meta?.textContent).toContain("1p");
    expect(meta?.style.width).toBe(`${getChipLeadingColumnWidth([{ leadingLabel: "1:00 PM" }])}px`);
    expect(content?.style.gridTemplateColumns).toBe(`${meta?.style.width} minmax(0, 1fr)`);
    expect(ghost.querySelector("[data-calendar-span-title-text='true']")?.textContent).toBe("Check-in IHSS");
  });

  it("keeps selected span title metrics stable", () => {
    const title = "Advanced machine learning project review and lab planning";
    render(
      <CalendarEventSpanOverlay
        segments={[
          {
            id: "event-plain:2026-04-20:2026-04-22",
            kind: "event",
            eventId: "event-plain",
            row: 1,
            columnStart: 2,
            columnEnd: 5,
            lane: 0,
            segmentStart: "2026-04-20",
            segmentEnd: "2026-04-22",
            item: {
              id: "event-plain",
              title,
              startTime: "09:00",
              color: "#89b4fa",
            },
          },
          {
            id: "event-selected:2026-04-20:2026-04-22",
            kind: "event",
            eventId: "event-selected",
            row: 2,
            columnStart: 2,
            columnEnd: 5,
            lane: 1,
            segmentStart: "2026-04-20",
            segmentEnd: "2026-04-22",
            item: {
              id: "event-selected",
              title,
              startTime: "09:00",
              color: "#89b4fa",
            },
          },
        ]}
        layout={{ cellHeight: 120, gridGap: 4, tier: "lg" }}
        gridRowCount={6}
        selectedItemId="event-selected"
      />,
    );

    const titles = screen
      .getAllByTestId("calendar-event-span-segment")
      .map((chip) => chip.querySelector("[data-calendar-span-title-fit]"));

    expect(titles[0]?.getAttribute("data-calendar-span-title-fit")).toBe(
      titles[1]?.getAttribute("data-calendar-span-title-fit"),
    );
    expect(titles[0]?.style.fontWeight).toBe(titles[1]?.style.fontWeight);
  });

  it("routes modifier-clicks on span segments into the Calendar Event Selection Set", () => {
    const event = {
      id: "event-span",
      title: "Conference",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
      writable: true,
      color: "#89b4fa",
    };
    const toggleEventSelection = vi.fn(() => true);
    const onSelectSegment = vi.fn();
    render(
      <CalendarEventSpanOverlay
        segments={[{
          id: "event-span:2026-04-20:2026-04-22",
          kind: "event",
          eventId: "event-span",
          row: 1,
          columnStart: 2,
          columnEnd: 5,
          lane: 0,
          segmentStart: "2026-04-20",
          segmentEnd: "2026-04-22",
          item: event,
        }]}
        layout={{ cellHeight: 120, gridGap: 4, tier: "lg" }}
        gridRowCount={6}
        quickActions={{
          isEventSelectionSelected: (candidate) => candidate?.id === "event-span",
          toggleEventSelection,
        }}
        onSelectSegment={onSelectSegment}
      />,
    );

    const segment = screen.getByTestId("calendar-event-span-segment");
    segment.getBoundingClientRect = () => ({
      left: 0,
      right: 300,
      top: 0,
      bottom: 36,
      width: 300,
      height: 36,
    });
    expect(segment.getAttribute("data-calendar-event-selection")).toBe("true");

    fireEvent.click(segment, { ctrlKey: true, clientX: 4 });

    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event,
      dateKey: "2026-04-20",
      anchorKind: "span",
    }));
    expect(onSelectSegment).not.toHaveBeenCalled();
  });
});
