import { describe, expect, it, vi, afterEach } from "vitest";
import { deriveFocusWindows, focusPressureDate, focusPressureTarget } from "./focus-windows";

afterEach(() => {
  vi.useRealTimers();
});

function eventAt(now, startOffsetMin, endOffsetMin, title) {
  return {
    id: title,
    title,
    startMs: now + startOffsetMin * 60000,
    endMs: now + endOffsetMin * 60000,
    allDay: false,
  };
}

describe("deriveFocusWindows", () => {
  it("returns the best protected block from a simple event day", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = deriveFocusWindows({
      now,
      events: [
        eventAt(now, 120, 150, "Planning"),
      ],
      deadlines: [],
    });

    expect(result.primaryWindow).toBeTruthy();
    expect(result.primaryWindow.durationMin).toBeGreaterThanOrEqual(110);
    expect(result.primaryWindow.timeRangeLabel).toBeTruthy();
  });

  it("returns a backup block when multiple usable gaps exist", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = deriveFocusWindows({
      now,
      events: [
        eventAt(now, 70, 100, "Sync"),
        eventAt(now, 240, 270, "Review"),
      ],
      deadlines: [],
    });

    expect(result.primaryWindow).toBeTruthy();
    expect(result.backupWindow).toBeTruthy();
    expect(result.primaryWindow.timeRangeLabel).not.toBe(result.backupWindow.timeRangeLabel);
  });

  it("handles no future events by surfacing the rest of the day as open", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = deriveFocusWindows({
      now,
      events: [],
      deadlines: [],
    });

    expect(result.primaryWindow).toBeTruthy();
    expect(result.primaryWindow.quality).toBe("Rest of day open");
    expect(result.primaryWindow.explanation).toContain("No more events today");
  });

  it("handles days with no protected block left", () => {
    const now = new Date("2026-04-20T06:30:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = deriveFocusWindows({
      now,
      events: [
        eventAt(now, 8, 18, "Quick sync"),
        eventAt(now, 22, 28, "Check-in"),
      ],
      deadlines: [],
    });

    expect(result.primaryWindow).toBeNull();
    expect(result.openWindowStatus?.kind).toBe("none");
  });

  it("uses deadline pressure in the explanation context", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = deriveFocusWindows({
      now,
      events: [
        eventAt(now, 120, 150, "Planning"),
      ],
      deadlines: [
        {
          id: "todo-1",
          title: "Reply",
          due_date: "2026-04-19",
          due_time: "5:00 PM",
          status: "open",
        },
      ],
    });

    expect(result.pressure.level).toBe("high");
    expect(result.primaryWindow.explanation).toContain("deadline");
  });

  it("finds the nearest relevant pressure date across overdue, today, and soon deadlines", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = focusPressureDate([
      {
        id: "soon",
        due_date: "2026-04-21",
        due_time: "9:00 AM",
        status: "open",
      },
      {
        id: "today",
        due_date: "2026-04-19",
        due_time: "6:00 PM",
        status: "open",
      },
      {
        id: "complete",
        due_date: "2026-04-18",
        due_time: "8:00 AM",
        status: "complete",
      },
    ], now);

    expect(result).toBe("2026-04-19");
  });

  it("finds the nearest relevant pressure target with its item id", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = focusPressureTarget([
      {
        id: "soon",
        due_date: "2026-04-21",
        due_time: "9:00 AM",
        status: "open",
      },
      {
        id: "today",
        due_date: "2026-04-19",
        due_time: "6:00 PM",
        status: "open",
      },
    ], now);

    expect(result).toMatchObject({
      date: "2026-04-19",
      id: "today",
    });
  });
});
