import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MiniCalendar from "./MiniCalendar.jsx";

afterEach(() => {
  cleanup();
});

describe("MiniCalendar", () => {
  it("renders a stable six-row grid with selected, today, and adjacent date semantics", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
      />,
    );

    expect(screen.getByTestId("calendar-mini-calendar").getAttribute("data-row-count")).toBe("6");
    expect(screen.getAllByTestId("calendar-mini-calendar-date")).toHaveLength(42);
    expect(screen.getByRole("button", { name: /Friday, May 15, today/i }).getAttribute("data-date-tone")).toBe("today");
    expect(screen.getByRole("button", { name: /Wednesday, May 20, selected/i }).getAttribute("data-date-fill")).toBe("selected");
    expect(screen.getByRole("button", { name: /Sunday, April 26/i }).getAttribute("data-adjacent-position")).toBe("leading");
    expect(screen.getByRole("button", { name: /Saturday, June 6/i }).getAttribute("data-adjacent-position")).toBe("trailing");
  });

  it("renders true-color markers with the deadline check after dot markers", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
        activityItems={[
          { id: "event-1", dateKey: "2026-06-01", kind: "event", color: "#89b4fa" },
          { id: "bill-1", dateKey: "2026-06-01", kind: "bill", color: "#f97316" },
          { id: "deadline-1", dateKey: "2026-06-01", kind: "deadline", color: "#a6e3a1" },
        ]}
      />,
    );

    const juneOne = screen.getByRole("button", { name: /Monday, June 1/i });
    expect(juneOne.getAttribute("data-adjacent-position")).toBe("trailing");

    const markers = within(juneOne).getAllByTestId("calendar-mini-calendar-marker");
    expect(markers.map((marker) => marker.getAttribute("data-marker-kind"))).toEqual([
      "dot",
      "dot",
      "deadline",
    ]);
    expect(markers.map((marker) => marker.getAttribute("data-marker-color"))).toEqual([
      "#89b4fa",
      "#f97316",
      "#a6e3a1",
    ]);
  });

  it("lets hover preview source color override selected and today date treatment", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-15"
        activityItems={[
          { id: "event-1", dateKey: "2026-05-15", kind: "event", color: "#e8776a" },
        ]}
        hoverPreviewItem={{
          id: "event-1",
          startDate: "2026-05-15",
          kind: "event",
          color: "#e8776a",
        }}
      />,
    );

    const mayFifteen = screen.getByRole("button", { name: /Friday, May 15, today, selected/i });
    expect(mayFifteen.getAttribute("data-hover-preview")).toBe("active");
    expect(mayFifteen.getAttribute("data-date-fill")).toBe("hover-preview");
    expect(mayFifteen.getAttribute("data-hover-preview-color")).toBe("#e8776a");
    expect(mayFifteen.style.borderColor).toBe("transparent");
    expect(mayFifteen.style.background).toBe("rgb(232, 119, 106)");
    expect(within(mayFifteen).getByTestId("calendar-mini-calendar-date-number").style.background).toBe("transparent");
    const marker = within(mayFifteen).getByTestId("calendar-mini-calendar-marker");
    expect(marker.getAttribute("data-marker-color")).toBe("#e8776a");
    expect(marker.getAttribute("data-marker-contrast-ring")).toBe("dark");
    expect(marker.style.background).toBe("rgb(232, 119, 106)");
    expect(marker.style.boxShadow).toContain("rgba(14, 15, 22, 0.74)");
  });

  it("uses the square cell visual for selected dates and selected today", () => {
    const { rerender } = render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
        activityItems={[
          { id: "event-1", dateKey: "2026-05-20", kind: "event", color: "#89b4fa" },
        ]}
      />,
    );

    const selectedDate = screen.getByRole("button", { name: /Wednesday, May 20, selected/i });
    expect(selectedDate.getAttribute("data-date-fill")).toBe("selected");
    expect(selectedDate.style.background).toBe("rgba(177, 177, 179, 0.72)");
    expect(within(selectedDate).getByTestId("calendar-mini-calendar-date-number").style.background).toBe("transparent");
    expect(within(selectedDate).getByTestId("calendar-mini-calendar-marker")).toBeTruthy();

    rerender(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-15"
        activityItems={[
          { id: "event-2", dateKey: "2026-05-15", kind: "event", color: "#89b4fa" },
        ]}
      />,
    );

    const todaySelected = screen.getByRole("button", { name: /Friday, May 15, today, selected/i });
    expect(todaySelected.getAttribute("data-date-fill")).toBe("today-selected");
    expect(todaySelected.style.background).toBe("rgb(4, 149, 255)");
    expect(within(todaySelected).getByTestId("calendar-mini-calendar-date-number").style.background).toBe("transparent");
    expect(within(todaySelected).getByTestId("calendar-mini-calendar-marker")).toBeTruthy();
  });

  it("adds a light contrast halo for deadline markers on dark preview colors", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
        activityItems={[
          { id: "deadline-1", dateKey: "2026-05-22", kind: "deadline", color: "#7c3aed" },
        ]}
        hoverPreviewItem={{
          id: "deadline-1",
          startDate: "2026-05-22",
          kind: "deadline",
          color: "#7c3aed",
        }}
      />,
    );

    const previewDate = screen.getByRole("button", { name: "Friday, May 22" });
    const marker = within(previewDate).getByTestId("calendar-mini-calendar-marker");
    expect(marker.getAttribute("data-marker-kind")).toBe("deadline");
    expect(marker.getAttribute("data-marker-color")).toBe("#7c3aed");
    expect(marker.getAttribute("data-marker-contrast-ring")).toBe("light");
    expect(marker.style.color).toBe("rgb(124, 58, 237)");
    expect(marker.style.textShadow).toContain("rgba(248, 250, 255, 0.82)");
  });

  it("renders multi-day all-day hover previews as continuous row segments", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
        activityItems={[
          { id: "event-1", dateKey: "2026-05-01", kind: "event", color: "#a6e3a1" },
        ]}
        hoverPreviewItem={{
          id: "conference",
          allDay: true,
          startDate: "2026-05-01",
          endDate: "2026-05-10",
          kind: "event",
          color: "#a6e3a1",
        }}
      />,
    );

    const segments = screen.getAllByTestId("calendar-mini-calendar-hover-preview");
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.getAttribute("data-segment-start"))).toEqual([
      "2026-05-01",
      "2026-05-03",
      "2026-05-10",
    ]);
    expect(segments.map((segment) => segment.getAttribute("data-segment-end"))).toEqual([
      "2026-05-02",
      "2026-05-09",
      "2026-05-10",
    ]);
    expect(segments.every((segment) => segment.getAttribute("data-preview-color") === "#a6e3a1")).toBe(true);
    expect(segments.every((segment) => segment.style.background === "rgb(166, 227, 161)")).toBe(true);
    expect(segments.every((segment) => segment.style.borderStyle !== "solid")).toBe(true);
    expect(segments.every((segment) => segment.style.alignSelf === "stretch")).toBe(true);
    expect(segments.every((segment) => segment.style.height === "26px")).toBe(true);

    const firstPreviewDate = screen.getByRole("button", { name: "Friday, May 1" });
    const marker = within(firstPreviewDate).getByTestId("calendar-mini-calendar-marker");
    expect(marker.getAttribute("data-marker-contrast-ring")).toBe("dark");
    expect(marker.style.boxShadow).toContain("rgba(14, 15, 22, 0.74)");
  });

  it("splits the mini calendar month title into white month text and solid red year text", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
      />,
    );

    expect(screen.getByTestId("calendar-mini-calendar-month-label").textContent).toBe("May");
    expect(screen.getByTestId("calendar-mini-calendar-month-label").style.color).toBe("rgb(248, 250, 255)");
    expect(screen.getByTestId("calendar-mini-calendar-year-label").textContent).toBe("2026");
    expect(screen.getByTestId("calendar-mini-calendar-year-label").style.color).toBe("rgb(255, 69, 58)");
  });

  it("exposes compact month controls through provided callbacks only", () => {
    const onPreviousMonth = vi.fn();
    const onNextMonth = vi.fn();

    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
        canGoPrev
        onPreviousMonth={onPreviousMonth}
        onNextMonth={onNextMonth}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /previous mini calendar month/i }));
    fireEvent.click(screen.getByRole("button", { name: /next mini calendar month/i }));

    expect(onPreviousMonth).toHaveBeenCalledTimes(1);
    expect(onNextMonth).toHaveBeenCalledTimes(1);
  });

  it("uses ordinary date controls for click, Enter, Space, and double-click create callbacks", () => {
    const onDateAction = vi.fn();
    const onDateCreate = vi.fn();

    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
        onDateAction={onDateAction}
        onDateCreate={onDateCreate}
      />,
    );

    const date = screen.getByRole("button", { name: /Thursday, May 21/i });

    fireEvent.click(date);
    fireEvent.keyDown(date, { key: "Enter" });
    fireEvent.keyDown(date, { key: " " });
    fireEvent.doubleClick(date);

    expect(onDateAction).toHaveBeenCalledTimes(3);
    expect(onDateAction).toHaveBeenCalledWith("2026-05-21");
    expect(onDateCreate).toHaveBeenCalledTimes(1);
    expect(onDateCreate).toHaveBeenCalledWith("2026-05-21");
  });
});
