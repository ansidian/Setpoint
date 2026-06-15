/* global process */
import { describe, expect, it, vi, afterEach } from "vitest";
import { deriveFocusWindows, focusPressureDate, focusPressureTarget, endOfPacificDayMs } from "./focus-windows";

afterEach(() => {
  vi.useRealTimers();
});

// endOfPacificDayMs must anchor to the true Pacific midnight-minus-one-minute
// instant regardless of the host's local timezone. Force a UTC host so the old
// offsetless `T23:59:59.999` (parsed local) diverges from the Pacific anchor.
describe("endOfPacificDayMs", () => {
  const realTz = process.env.TZ;
  afterEach(() => {
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
  });

  it("anchors end-of-day to true Pacific 23:59 even on a non-Pacific client", () => {
    process.env.TZ = "UTC";
    // now = noon Pacific on 2026-01-15 (PST). End of that Pacific day == 2026-01-16T07:59Z.
    const now = Date.parse("2026-01-15T20:00:00Z");
    expect(new Date(endOfPacificDayMs(now)).toISOString()).toBe("2026-01-16T07:59:00.000Z");
  });
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

  it("labels a long low-pressure open stretch as the most protected block", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // One short morning event, then the rest of the day stays open: a >=90min,
    // low-pressure stretch that reaches end of day. There is still a future
    // event, so this is the "Most protected" label (not "Rest of day open").
    const result = deriveFocusWindows({
      now,
      events: [
        eventAt(now, 30, 60, "Standup"),
      ],
      deadlines: [],
    });

    expect(result.pressure.level).toBe("low");
    expect(result.primaryWindow).toBeTruthy();
    expect(result.primaryWindow.durationMin).toBeGreaterThanOrEqual(90);
    expect(result.primaryWindow.quality).toBe("Most protected");
    expect(result.primaryWindow.explanation).toBe(
      "Long enough for deep work while the calendar stays open.",
    );
  });

  it("labels a 45-59min gap before the next event as usable", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // A single all-day-sized blocker starting 55min out leaves exactly one
    // candidate gap: now -> (start - 5min buffer) = 50min. That lands in the
    // 45-59min "Usable" band (>=45 but below the 60min "Cleanest" threshold).
    const result = deriveFocusWindows({
      now,
      events: [
        eventAt(now, 55, 900, "Workshop"),
      ],
      deadlines: [],
    });

    expect(result.primaryWindow).toBeTruthy();
    expect(result.primaryWindow.durationMin).toBe(50);
    expect(result.primaryWindow.quality).toBe("Usable");
    expect(result.primaryWindow.explanation).toBe(
      "Long enough for deep work before your next event.",
    );
  });

  it("surfaces a 10-24min only gap as a short window with no protected block", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // A blocker starting 20min out leaves only a now -> (20-5)=15min gap. That
    // is below the 25min protected minimum but at/above the 10min short floor,
    // so no primary/backup block exists, just a short-window status.
    const result = deriveFocusWindows({
      now,
      events: [
        eventAt(now, 20, 900, "Wall"),
      ],
      deadlines: [],
    });

    expect(result.primaryWindow).toBeNull();
    expect(result.backupWindow).toBeNull();
    expect(result.openWindowStatus).toMatchObject({
      kind: "short-window",
      durationLabel: "15 min",
    });
    expect(result.openWindowStatus.timeRangeLabel).toBeTruthy();
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
