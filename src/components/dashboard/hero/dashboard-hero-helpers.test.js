import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHeroCallouts } from "./dashboard-hero-helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("buildHeroCallouts", () => {
  it("carries stable identities and dates for concrete dashboard callouts", () => {
    const now = new Date("2026-04-19T16:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const [eventCallout, deadlineCallout, billCallout] = buildHeroCallouts({
      now,
      events: [
        {
          id: "event-1",
          title: "Design review",
          startMs: now + 30 * 60000,
          endMs: now + 60 * 60000,
          location: "Studio",
        },
      ],
      deadlines: [
        {
          id: "deadline-1",
          title: "Project due",
          due_date: "2026-04-20",
          source: "todoist",
          status: "open",
        },
      ],
      bills: [
        {
          id: "bill-1",
          name: "Rent",
          next_date: "2026-04-21",
          amount: 1800,
          paid: false,
        },
      ],
    });

    expect(eventCallout).toMatchObject({
      kind: "event",
      id: "event-1",
      date: "2026-04-19",
    });
    expect(deadlineCallout).toMatchObject({
      kind: "deadline",
      id: "deadline-1",
      date: "2026-04-20",
    });
    expect(billCallout).toMatchObject({
      kind: "bill",
      id: "bill-1",
      date: "2026-04-21",
    });
  });
});
