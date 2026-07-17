import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useDashboardItemSheet from "./useDashboardItemSheet";
import type { CalendarOpenOptions, DashboardGlanceSheet, DashboardTab } from "./dashboardShellModel";

type SheetCase = [
  DashboardGlanceSheet,
  [string, string | null, string | null, CalendarOpenOptions],
];

describe("useDashboardItemSheet", () => {
  it("owns selection and closes the dashboard sheet when its tab is left", () => {
    const openCalendar = vi.fn();
    const { result, rerender } = renderHook(
      ({ tab }) => useDashboardItemSheet({ tab: tab as DashboardTab, openCalendar }),
      { initialProps: { tab: "dashboard" } },
    );
    const task = { id: "task-1", title: "File report" };

    act(() => result.current.openDeadline(task, { id: "anchor" }));
    expect(result.current.itemSheet).toMatchObject({
      kind: "deadline",
      item: task,
      anchorRef: { current: { id: "anchor" } },
    });

    rerender({ tab: "calendar" });
    expect(result.current.itemSheet).toBeNull();
  });

  it("opens bill and event sheets when item data is present and otherwise routes directly", () => {
    const openCalendar = vi.fn();
    const { result } = renderHook(() => useDashboardItemSheet({
      tab: "dashboard",
      openCalendar,
    }));
    const bill = { id: "bill-1", name: "Electric" };

    act(() => result.current.openBill("2026-07-15", "bill-1", bill, null));
    expect(result.current.itemSheet).toMatchObject({ kind: "bill", item: bill });

    act(() => result.current.openEvent("2026-07-16", "event-1"));
    expect(openCalendar).toHaveBeenLastCalledWith("events", "2026-07-16", "event-1", {
      source: "dashboard",
      openDetail: true,
      forceEventOverlay: true,
    });

    act(() => result.current.openBill("2026-07-17", "bill-2"));
    expect(openCalendar).toHaveBeenLastCalledWith("bills", "2026-07-17", "bill-2", {
      source: "dashboard",
      openDetail: true,
    });
  });

  it.each(([
    [
      { kind: "deadline", item: { id: "task-1", due_date: "2026-07-18" } },
      ["events", "2026-07-18", "deadline:task-1:2026-07-18", {
        source: "dashboard",
        openDetail: true,
        forceDeadlineOverlay: true,
        forceCompletedDeadlineOverlay: true,
      }],
    ],
    [
      { kind: "bill", item: { id: "bill-1" }, date: "2026-07-19", itemId: "bill-1" },
      ["bills", "2026-07-19", "bill-1", {
        source: "dashboard",
        openDetail: true,
      }],
    ],
    [
      { kind: "event", item: { id: "event-1" }, date: "2026-07-20", itemId: "event-1" },
      ["events", "2026-07-20", "event-1", {
        source: "dashboard",
        openDetail: true,
        forceEventOverlay: true,
      }],
    ],
  ] satisfies SheetCase[]))("closes the %s sheet before handing it off to the calendar", (sheet, expectedCall) => {
    const openCalendar = vi.fn();
    const { result } = renderHook(() => useDashboardItemSheet({
      tab: "dashboard",
      openCalendar,
    }));

    act(() => {
      if (sheet.kind === "deadline") result.current.openDeadline(sheet.item);
      else if (sheet.kind === "bill") {
        result.current.openBill(sheet.date, sheet.itemId, sheet.item);
      } else {
        result.current.openEvent(sheet.date, sheet.itemId, sheet.item);
      }
    });
    act(() => result.current.openInCalendar(sheet));

    expect(result.current.itemSheet).toBeNull();
    expect(openCalendar).toHaveBeenCalledWith(...expectedCall);
  });
});
