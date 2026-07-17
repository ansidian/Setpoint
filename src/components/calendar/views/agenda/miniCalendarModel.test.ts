import { describe, expect, it } from "vitest";
import {
  MINI_CALENDAR_MARKER_LIMIT,
  buildMiniCalendarCells,
  buildMiniCalendarHoverPreview,
  buildMiniCalendarModel,
  deriveMiniCalendarActivityMarkers,
} from "./miniCalendarModel.ts";

describe("mini calendar model", () => {
  it("builds a stable six-row month grid with adjacent-month cells", () => {
    const cells = buildMiniCalendarCells({
      viewYear: 2026,
      viewMonth: 4,
      todayKey: "2026-05-15",
      selectedDateKey: "2026-05-20",
      activatedDateKey: "2026-05-20",
    });

    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({
      dateKey: "2026-04-26",
      day: 26,
      inCurrentMonth: false,
      adjacentPosition: "leading",
      isToday: false,
      isSelected: false,
      isActivated: false,
      rowIndex: 0,
      weekdayIndex: 0,
    });
    expect(cells.find((cell) => cell.dateKey === "2026-05-15")).toMatchObject({
      day: 15,
      inCurrentMonth: true,
      adjacentPosition: "current",
      isToday: true,
      isSelected: false,
      isActivated: false,
      rowIndex: 2,
      weekdayIndex: 5,
    });
    expect(cells.find((cell) => cell.dateKey === "2026-05-20")).toMatchObject({
      isToday: false,
      isSelected: true,
      isActivated: true,
    });
    expect(cells[41]).toMatchObject({
      dateKey: "2026-06-06",
      adjacentPosition: "trailing",
      inCurrentMonth: false,
      rowIndex: 5,
      weekdayIndex: 6,
    });
  });

  it("derives capped dot markers and one deadline check marker from filtered agenda input", () => {
    const markersByDate = deriveMiniCalendarActivityMarkers([
      { id: "event-1", dateKey: "2026-05-12", kind: "event", color: "#89b4fa" },
      { id: "event-2", dateKey: "2026-05-12", kind: "event", sourceColor: "#a6e3a1" },
      { id: "event-3", dateKey: "2026-05-12", kind: "event", agendaSourceColor: "#f9e2af" },
      { id: "bill-1", dateKey: "2026-05-12", kind: "bill", agendaDotColor: "#f97316" },
      { id: "deadline-1", dateKey: "2026-05-12", kind: "deadline", color: "#cba6da" },
      { id: "deadline-2", dateKey: "2026-05-12", kind: "deadline", color: "#f38ba8" },
    ]);

    expect(markersByDate["2026-05-12"]!).toHaveLength(MINI_CALENDAR_MARKER_LIMIT);
    expect(markersByDate["2026-05-12"]!.map((marker) => marker.kind)).toEqual([
      "dot",
      "dot",
      "dot",
      "deadline",
    ]);
    expect(markersByDate["2026-05-12"]![3]).toMatchObject({
      shape: "check",
      count: 2,
      representsOverflow: true,
    });
  });

  it("uses omitted agenda input as the visible filtering boundary", () => {
    const markersByDate = deriveMiniCalendarActivityMarkers([
      { id: "visible-event", dateKey: "2026-05-08", kind: "event", color: "#89b4fa" },
    ]);

    expect(markersByDate["2026-05-08"]!).toHaveLength(1);
    expect(markersByDate["2026-05-09"]!).toBeUndefined();
  });

  it("counts multi-day all-day items on every touched date", () => {
    const markersByDate = deriveMiniCalendarActivityMarkers([
      {
        id: "trip",
        kind: "event",
        allDay: true,
        startDate: "2026-05-03",
        endDate: "2026-05-05",
        color: "#89b4fa",
      },
    ]);

    expect(Object.keys(markersByDate)).toEqual([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
    ]);
    expect(markersByDate["2026-05-04"]![0]).toMatchObject({
      kind: "dot",
      itemId: "trip",
      color: "#89b4fa",
    });
  });

  it("returns multi-day all-day hover preview range and row segments", () => {
    const cells = buildMiniCalendarCells({
      viewYear: 2026,
      viewMonth: 4,
      todayKey: "2026-05-15",
      selectedDateKey: "2026-05-20",
    });

    const preview = buildMiniCalendarHoverPreview({
      item: {
        id: "conference",
        kind: "event",
        allDay: true,
        startDate: "2026-05-01",
        endDate: "2026-05-10",
        sourceColor: "#a6e3a1",
      },
      cells,
    });

    expect(preview).toMatchObject({
      itemId: "conference",
      color: "#a6e3a1",
      startDate: "2026-05-01",
      endDate: "2026-05-10",
      isMultiDayAllDay: true,
    });
    expect(preview!.dateKeys).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
      "2026-05-10",
    ]);
    expect(preview!.segments).toEqual([
      expect.objectContaining({
        rowIndex: 0,
        columnStart: 5,
        columnEnd: 7,
        segmentStart: "2026-05-01",
        segmentEnd: "2026-05-02",
      }),
      expect.objectContaining({
        rowIndex: 1,
        columnStart: 0,
        columnEnd: 7,
        segmentStart: "2026-05-03",
        segmentEnd: "2026-05-09",
      }),
      expect.objectContaining({
        rowIndex: 2,
        columnStart: 0,
        columnEnd: 1,
        segmentStart: "2026-05-10",
        segmentEnd: "2026-05-10",
      }),
    ]);
  });

  it("attaches markers and preview state to the calendar cells", () => {
    const model = buildMiniCalendarModel({
      viewYear: 2026,
      viewMonth: 4,
      todayKey: "2026-05-15",
      selectedDateKey: "2026-05-20",
      activityItems: [
        { id: "bill-1", dateKey: "2026-05-20", kind: "bill", color: "#f97316" },
      ],
      hoverPreviewItem: {
        id: "bill-1",
        dateKey: "2026-05-20",
        kind: "bill",
        color: "#f97316",
      },
    });

    expect(model.cells.find((cell) => cell.dateKey === "2026-05-20")).toMatchObject({
      isSelected: true,
      markers: [expect.objectContaining({ itemId: "bill-1", color: "#f97316" })],
      hoverPreview: expect.objectContaining({
        itemId: "bill-1",
        color: "#f97316",
      }),
    });
  });
});
