import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEffect, useRef, type ComponentProps } from "react";
import CalendarCell from "../../components/calendar/modal/CalendarCell";
import { dateCellSelector } from "./calendarFloatingDetailModel";
import useCalendarFloatingDetail from "./useCalendarFloatingDetail";

// Integration coverage for the DOM anchor contract between CalendarCell and
// useCalendarFloatingDetail.findDateCell: the cell must stay reachable via
// dateCellSelector or floating editors silently park instead of anchoring.

const hookHolder: { current: ReturnType<typeof useCalendarFloatingDetail> | null } = { current: null };

function cellProps(day: number, dateKey: string): ComponentProps<typeof CalendarCell> {
  return {
    view: "events",
    viewYear: 2026,
    viewMonth: 3,
    viewLabel: "Events",
    day,
    dateKey,
    dateLabel: String(day),
    items: [],
    ghosts: [],
    cellMeta: {},
    itemCount: 0,
    hasItems: false,
    isToday: false,
    isSelected: false,
    inCurrentMonth: true,
    renderCellContents: () => null,
  } as ComponentProps<typeof CalendarCell>;
}

function Harness() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const hook = useCalendarFloatingDetail({ open: true, view: "events", panelRef, railRef });
  useEffect(() => {
    hookHolder.current = hook;
  });
  const openCreateFor = (dateKey: string) => () => {
    hook.openFloatingDetail({ mode: "create", view: "events", dateKey });
  };
  return (
    <div ref={panelRef}>
      <CalendarCell {...cellProps(7, "2026-04-07")} onSelectDay={openCreateFor("2026-04-07")} />
      <CalendarCell {...cellProps(8, "2026-04-08")} onSelectDay={openCreateFor("2026-04-08")} />
    </div>
  );
}

describe("useCalendarFloatingDetail DOM anchoring", () => {
  beforeEach(() => {
    hookHolder.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders calendar cells that satisfy the floating-detail anchor selector contract", () => {
    render(<Harness />);

    const cell = screen.getByTestId("calendar-cell-7");
    expect(cell.matches(dateCellSelector("2026-04-07"))).toBe(true);
    expect(document.querySelectorAll(dateCellSelector("2026-04-07"))).toHaveLength(1);
  });

  it("anchors the floating editor to the clicked cell", () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId("calendar-cell-8"));

    expect(hookHolder.current!.floatingDetail).toMatchObject({
      open: true,
      mode: "create",
      dateKey: "2026-04-08",
      anchorKind: "day-cell",
    });
    expect(hookHolder.current!.floatingDetail!.anchorElement).toBe(screen.getByTestId("calendar-cell-8"));
  });

  it("re-resolves the anchor to the matching cell when reopened for another date", () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId("calendar-cell-8"));
    act(() => {
      hookHolder.current!.openFloatingDetail({ mode: "create", view: "events", dateKey: "2026-04-07" });
    });

    expect(hookHolder.current!.floatingDetail).toMatchObject({
      dateKey: "2026-04-07",
      anchorKind: "day-cell",
    });
    expect(hookHolder.current!.floatingDetail!.anchorElement).toBe(screen.getByTestId("calendar-cell-7"));
    expect(hookHolder.current!.findDateCell("2026-04-08")).toBe(screen.getByTestId("calendar-cell-8"));
  });

  it("opens with a null anchor when no cell satisfies the anchor contract", () => {
    // Parking is rAF-driven at the placement layer now; the hook's contract is
    // that an unmatched dateKey yields no anchor element instead of a stale or
    // wrong-cell anchor.
    render(<Harness />);

    act(() => {
      hookHolder.current!.openFloatingDetail({ mode: "create", view: "events", dateKey: "2026-05-01" });
    });

    expect(hookHolder.current!.floatingDetail).toMatchObject({
      open: true,
      dateKey: "2026-05-01",
    });
    expect(hookHolder.current!.floatingDetail!.anchorElement).toBeNull();
  });
});
