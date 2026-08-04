import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarCell from "./CalendarCell";

afterEach(() => {
  cleanup();
});

const baseCellProps = {
  view: "events",
  viewYear: 2026,
  viewMonth: 3,
  viewLabel: "Events",
  day: 7,
  dateKey: "2026-04-07",
  dateLabel: "7",
  items: [],
  ghosts: [],
  cellMeta: {},
  itemCount: 0,
  hasItems: false,
  isToday: false,
  isSelected: false,
  renderCellContents: () => null,
};

function dataTransferWith(map: Record<string, string>) {
  return { getData: vi.fn((type: string) => map[type] ?? "") };
}

describe("CalendarCell", () => {
  it("renders weather inline with the date header", () => {
    render(
      <CalendarCell
        view="events"
        viewYear={2026}
        viewMonth={3}
        viewLabel="Events"
        day={7}
        dateKey="2026-04-07"
        dateLabel="7"
        items={[]}
        ghosts={[]}
        cellMeta={{
          weather: {
            dateKey: "2026-04-07",
            high: 83,
            low: 61,
            icon: "Sun",
            summary: "Sunny",
          },
        }}
        itemCount={0}
        hasItems={false}
        isToday={false}
        isSelected={false}
        renderCellContents={() => null}
      />,
    );

    const header = screen.getByTestId("calendar-cell-header");
    const weather = screen.getByTestId("calendar-cell-weather");

    expect(header.contains(screen.getByTestId("calendar-cell-date-header-2026-04-07"))).toBe(true);
    expect(header.contains(weather)).toBe(true);
    expect(weather.textContent).toBe("83/61");
    expect(weather.getAttribute("aria-label")).toBe("Sunny");
    expect(weather.getAttribute("title")).toBe("Sunny");
  });
});

describe("CalendarCell drag-drop routing", () => {

  it("still routes an event drop to dropEvent when an event is being dragged", () => {
    const dropEvent = vi.fn();
    const droppedEvent = { id: "event-1", title: "Hold" };
    render(
      <CalendarCell
        {...baseCellProps}
        quickActions={{ draggingEventId: "event-1", dropEvent, enterDropTarget: vi.fn() }}
      />,
    );

    fireEvent.drop(screen.getByRole("gridcell"), {
      dataTransfer: dataTransferWith({ "application/x-ea-calendar-event": JSON.stringify(droppedEvent) }),
    });

    expect(dropEvent).toHaveBeenCalledWith(expect.objectContaining({ event: droppedEvent, targetDate: "2026-04-07" }));
  });

  it("ignores a drop when nothing is being dragged", () => {
    const dropDeadline = vi.fn();
    const dropEvent = vi.fn();
    render(
      <CalendarCell {...baseCellProps} quickActions={{ dropDeadline, dropEvent }} />,
    );

    fireEvent.drop(screen.getByRole("gridcell"), {
      dataTransfer: dataTransferWith({ "application/x-ea-calendar-deadline": JSON.stringify({ id: "x" }) }),
    });

    expect(dropDeadline).not.toHaveBeenCalled();
    expect(dropEvent).not.toHaveBeenCalled();
  });
});

describe("CalendarCell hover isolation (PERF-L03)", () => {
  it("does not re-invoke renderCellContents on pointer hover, and still fires drag-drop cleanup on pointer leave", () => {
    const renderCellContents = vi.fn(() => null);
    const leaveDropTarget = vi.fn();
    const leaveDeadlineDropTarget = vi.fn();
    render(
      <CalendarCell
        {...baseCellProps}
        renderCellContents={renderCellContents}
        quickActions={{ leaveDropTarget, leaveDeadlineDropTarget }}
      />,
    );

    const cell = screen.getByRole("gridcell");
    const callsAfterInitialRender = renderCellContents.mock.calls.length;

    fireEvent.pointerEnter(cell);
    fireEvent.pointerLeave(cell);

    expect(renderCellContents).toHaveBeenCalledTimes(callsAfterInitialRender);
    expect(leaveDropTarget).toHaveBeenCalledWith("2026-04-07");
    expect(leaveDeadlineDropTarget).toHaveBeenCalledWith("2026-04-07");
  });

  // The CSS hover-suppression rule in index.css guards on
  // `[data-overflow-open="true"][data-overflow-mode="inline"]` so that only
  // inline overflow suppresses hover, matching the original
  // `inlineOverflowOpen` JS condition — fallback (popover) overflow must NOT
  // suppress hover. CSS itself can't be asserted in this test environment,
  // so these pin the data-attribute wiring the CSS selector depends on.
  it("renders data-overflow-mode=\"inline\" (with data-overflow-open=\"true\") when inline overflow is open, which the CSS hover guard suppresses", () => {
    render(<CalendarCell {...baseCellProps} overflowOpen overflowMode="inline" />);

    const cell = screen.getByRole("gridcell");
    expect(cell.getAttribute("data-overflow-open")).toBe("true");
    expect(cell.getAttribute("data-overflow-mode")).toBe("inline");
  });

  it("renders data-overflow-mode=\"fallback\" when overflow is open in fallback/popover mode, which the CSS hover guard must NOT suppress", () => {
    render(<CalendarCell {...baseCellProps} overflowOpen overflowMode="fallback" />);

    const cell = screen.getByRole("gridcell");
    expect(cell.getAttribute("data-overflow-open")).toBe("true");
    expect(cell.getAttribute("data-overflow-mode")).toBe("fallback");
  });
});
