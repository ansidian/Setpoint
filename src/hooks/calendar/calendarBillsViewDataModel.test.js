import { describe, expect, it } from "vitest";
import { computeCalendarBillsViewData } from "./calendarBillsViewDataModel.js";

describe("computeCalendarBillsViewData", () => {
  it("uses range data for visible bills while preserving broad schedules and pay links", () => {
    const ensureRange = () => {};
    const billsData = {
      schedules: [{ id: "broad-1" }, { id: "broad-2" }],
      payLinksByScheduleId: { "broad-1": "https://pay.example/1" },
      pendingUpdate: true,
    };
    const rangeData = {
      schedules: [{ id: "visible-1" }],
      pendingUpdate: false,
    };

    expect(computeCalendarBillsViewData({
      billsData,
      billsRangeData: {
        data: rangeData,
        loading: true,
        error: new Error("range failed"),
        ensureRange,
        revision: 7,
      },
    })).toEqual({
      ...rangeData,
      allSchedules: billsData.schedules,
      payLinksByScheduleId: billsData.payLinksByScheduleId,
      isLoading: true,
      pendingUpdate: true,
      rangeError: expect.any(Error),
      ensureRange,
      revision: 7,
    });
  });

  it("does not announce a pending update when no visible bills exist", () => {
    expect(computeCalendarBillsViewData({
      billsData: { allSchedules: [{ id: "broad-only" }], pendingUpdate: true },
      billsRangeData: { data: { schedules: [] }, loading: true },
    })).toMatchObject({
      schedules: [],
      allSchedules: [{ id: "broad-only" }],
      isLoading: true,
      pendingUpdate: false,
      rangeError: null,
    });
  });
});
