import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlertCircle,
  Calendar,
  CreditCard,
  Plane,
  Video,
} from "lucide-react";
import { buildHeroCallouts } from "./dashboard-hero-helpers.js";

// All day math (daysUntil / todayPacific) reads `new Date()` and resolves the
// Pacific day boundary, so every case pins the clock to a fixed instant.
// 2026-04-19T16:00:00Z === 9:00am Pacific on 2026-04-19, so:
//   due "2026-04-19" → 0 days, "2026-04-20" → 1, "2026-04-21" → 2, "2026-04-25" → 6.
const NOW = new Date("2026-04-19T16:00:00.000Z").getTime();
const HOUR = 3600000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildHeroCallouts", () => {
  it("carries stable identities and dates for concrete dashboard callouts", () => {
    const [eventCallout, deadlineCallout, billCallout] = buildHeroCallouts({
      now: NOW,
      events: [
        {
          id: "event-1",
          title: "Design review",
          startMs: NOW + 30 * 60000,
          endMs: NOW + 60 * 60000,
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

  describe("empty / no-candidate inputs", () => {
    it("returns an empty array when nothing is passed", () => {
      expect(buildHeroCallouts({ now: NOW })).toEqual([]);
    });

    it("returns an empty array for empty source arrays", () => {
      expect(
        buildHeroCallouts({ now: NOW, events: [], deadlines: [], bills: [] }),
      ).toEqual([]);
    });
  });

  describe("event eligibility window (next 4 hours)", () => {
    const eventAt = (offsetMs) => ({
      now: NOW,
      events: [{ id: "e", title: "Standup", startMs: NOW + offsetMs }],
    });

    it("includes an event starting within the next 4 hours", () => {
      const out = buildHeroCallouts(eventAt(30 * 60000));
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe("event");
    });

    it("excludes an event that has already started (startMs <= now)", () => {
      // startMs === now is not > now, so it is filtered out.
      expect(buildHeroCallouts(eventAt(0))).toEqual([]);
    });

    it("excludes an event in the past", () => {
      expect(buildHeroCallouts(eventAt(-15 * 60000))).toEqual([]);
    });

    it("excludes an event 4+ hours out (boundary is exclusive)", () => {
      // startMs - now === 4h is not < 4h, so it is filtered out.
      expect(buildHeroCallouts(eventAt(4 * HOUR))).toEqual([]);
    });

    it("includes an event just inside the 4-hour boundary", () => {
      const out = buildHeroCallouts(eventAt(4 * HOUR - 60000));
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe("event");
    });

    it("picks the first matching event in array order, not the soonest", () => {
      // find() returns the first eligible item — there is no sort on events.
      const out = buildHeroCallouts({
        now: NOW,
        events: [
          { id: "later", title: "Later", startMs: NOW + 90 * 60000 },
          { id: "sooner", title: "Sooner", startMs: NOW + 10 * 60000 },
        ],
      });
      expect(out[0].id).toBe("later");
    });
  });

  describe("event urgency tiers (by minutes-until-start)", () => {
    const urgencyAtMinutes = (mins) => {
      const out = buildHeroCallouts({
        now: NOW,
        events: [{ id: "e", title: "Sync", startMs: NOW + mins * 60000 }],
      });
      return out[0].urgency;
    };

    it.each([
      [5, "high"],
      [9, "high"],
      [10, "medium"],
      [30, "medium"],
      [44, "medium"],
      [45, "low"],
      [120, "low"],
    ])("%i minutes out → %s urgency", (mins, expected) => {
      expect(urgencyAtMinutes(mins)).toBe(expected);
    });

    it("formats the lead from minutes-until-start", () => {
      const out = buildHeroCallouts({
        now: NOW,
        events: [{ id: "e", title: "Sync", startMs: NOW + 90 * 60000 }],
      });
      expect(out[0].lead).toBe("In 1h 30m");
    });
  });

  describe("event icon selection per kind", () => {
    const eventIcon = (event) =>
      buildHeroCallouts({
        now: NOW,
        events: [{ id: "e", startMs: NOW + 30 * 60000, ...event }],
      })[0].icon;

    it("uses Video when a hangout link is present", () => {
      expect(eventIcon({ title: "1:1", hangoutLink: "https://meet.google.com/x" })).toBe(Video);
    });

    it("uses Video when the location mentions zoom (case-insensitive)", () => {
      expect(eventIcon({ title: "Sync", location: "ZOOM room 4" })).toBe(Video);
    });

    it("uses Plane when the title mentions a flight", () => {
      expect(eventIcon({ title: "Flight to SFO" })).toBe(Plane);
    });

    it("uses Plane when the title mentions an airport", () => {
      expect(eventIcon({ title: "Pick up at airport" })).toBe(Plane);
    });

    it("prefers Video over Plane when both a hangout link and a flight title are present", () => {
      // The video branch is evaluated first in the ternary chain.
      expect(eventIcon({ title: "Flight standup", hangoutLink: "https://meet.google.com/x" })).toBe(Video);
    });

    it("falls back to Calendar for a plain in-person event", () => {
      expect(eventIcon({ title: "Lunch", location: "Cafe" })).toBe(Calendar);
    });
  });

  describe("event attendee formatting (sub line)", () => {
    const eventSub = (event) =>
      buildHeroCallouts({
        now: NOW,
        events: [{ id: "e", title: "Sync", startMs: NOW + 30 * 60000, ...event }],
      })[0].sub;

    it("lists a single attendee", () => {
      expect(eventSub({ attendees: ["Ann"] })).toBe("with Ann");
    });

    it("lists two attendees joined by a comma", () => {
      expect(eventSub({ attendees: ["Ann", "Bob"] })).toBe("with Ann, Bob");
    });

    it("caps at the first two attendees and appends a +N overflow", () => {
      expect(eventSub({ attendees: ["Ann", "Bob", "Cy", "Dee"] })).toBe("with Ann, Bob +2");
    });

    it("falls back to the location when there are no attendees", () => {
      expect(eventSub({ location: "Studio" })).toBe("Studio");
    });

    it("falls back to the location for an empty attendees array", () => {
      expect(eventSub({ attendees: [], location: "Studio" })).toBe("Studio");
    });
  });

  describe("deadline selection and urgency", () => {
    const deadline = (over) => ({ id: "d", title: "Paper", source: "todoist", status: "open", ...over });

    it("uses the AlertCircle icon", () => {
      const out = buildHeroCallouts({ now: NOW, deadlines: [deadline({ due_date: "2026-04-20" })] });
      expect(out[0].icon).toBe(AlertCircle);
    });

    it.each([
      ["2026-04-19", "high"], // 0 days
      ["2026-04-20", "medium"], // 1 day
      ["2026-04-21", "medium"], // 2 days
      ["2026-04-22", "low"], // 3 days
      ["2026-04-25", "low"], // 6 days
    ])("due %s → %s urgency", (due_date, expected) => {
      const out = buildHeroCallouts({ now: NOW, deadlines: [deadline({ due_date })] });
      expect(out[0].urgency).toBe(expected);
    });

    it("labels a deadline due yesterday as high urgency", () => {
      // daysLabel maps a -1 offset to the special-cased "Yesterday".
      const out = buildHeroCallouts({ now: NOW, deadlines: [deadline({ due_date: "2026-04-18" })] });
      expect(out[0]).toMatchObject({ kind: "deadline", urgency: "high", lead: "Yesterday" });
    });

    it("labels a deadline several days overdue with an Nd-overdue lead", () => {
      const out = buildHeroCallouts({ now: NOW, deadlines: [deadline({ due_date: "2026-04-16" })] });
      expect(out[0]).toMatchObject({ kind: "deadline", urgency: "high", lead: "3d overdue" });
    });

    it("excludes a deadline more than 7 days out", () => {
      expect(buildHeroCallouts({ now: NOW, deadlines: [deadline({ due_date: "2026-04-27" })] })).toEqual([]);
    });

    it("excludes a completed deadline even when due soon", () => {
      expect(
        buildHeroCallouts({ now: NOW, deadlines: [deadline({ due_date: "2026-04-20", status: "complete" })] }),
      ).toEqual([]);
    });

    it("excludes a deadline with no due date", () => {
      expect(buildHeroCallouts({ now: NOW, deadlines: [deadline({ due_date: null })] })).toEqual([]);
    });

    it("picks the soonest deadline when several qualify", () => {
      const out = buildHeroCallouts({
        now: NOW,
        deadlines: [
          deadline({ id: "far", due_date: "2026-04-25" }),
          deadline({ id: "soon", due_date: "2026-04-20" }),
        ],
      });
      expect(out[0].id).toBe("soon");
    });

    it("prefers class_name over source for the sub line, and coerces a numeric id to a string", () => {
      const out = buildHeroCallouts({
        now: NOW,
        deadlines: [deadline({ id: 42, due_date: "2026-04-20", class_name: "CS101" })],
      });
      expect(out[0]).toMatchObject({ id: "42", sub: "CS101" });
    });
  });

  describe("bill selection and formatting", () => {
    const bill = (over) => ({ id: "b", name: "Rent", paid: false, ...over });

    it("uses the CreditCard icon", () => {
      const out = buildHeroCallouts({ now: NOW, bills: [bill({ next_date: "2026-04-21", amount: 1800 })] });
      expect(out[0].icon).toBe(CreditCard);
    });

    it.each([
      ["2026-04-19", "high"], // 0 days
      ["2026-04-20", "medium"], // 1 day
      ["2026-04-21", "medium"], // 2 days
      ["2026-04-24", "low"], // 5 days
    ])("due %s → %s urgency", (next_date, expected) => {
      const out = buildHeroCallouts({ now: NOW, bills: [bill({ next_date, amount: 50 })] });
      expect(out[0].urgency).toBe(expected);
    });

    it("formats the amount to two decimals and appends the payee", () => {
      const out = buildHeroCallouts({
        now: NOW,
        bills: [bill({ next_date: "2026-04-21", amount: 12.5, payee: "Acme Power" })],
      });
      expect(out[0].sub).toBe("$12.50 · Acme Power");
    });

    it("defaults a missing amount to $0.00 and a missing payee to empty", () => {
      const out = buildHeroCallouts({ now: NOW, bills: [bill({ next_date: "2026-04-21" })] });
      expect(out[0].sub).toBe("$0.00 · ");
    });

    it("excludes a bill more than 5 days out", () => {
      expect(buildHeroCallouts({ now: NOW, bills: [bill({ next_date: "2026-04-25" })] })).toEqual([]);
    });

    it("excludes a bill already marked paid", () => {
      expect(
        buildHeroCallouts({ now: NOW, bills: [bill({ next_date: "2026-04-21", paid: true })] }),
      ).toEqual([]);
    });

    it("picks the soonest unpaid bill when several qualify", () => {
      const out = buildHeroCallouts({
        now: NOW,
        bills: [
          bill({ id: "far", next_date: "2026-04-24" }),
          bill({ id: "soon", next_date: "2026-04-20" }),
        ],
      });
      expect(out[0].id).toBe("soon");
    });
  });

  describe("ordering and the 3-callout cap", () => {
    const fullInput = {
      now: NOW,
      events: [{ id: "e", title: "Sync", startMs: NOW + 30 * 60000 }],
      deadlines: [{ id: "d", title: "Paper", due_date: "2026-04-20", status: "open", source: "todoist" }],
      bills: [{ id: "b", name: "Rent", next_date: "2026-04-21", amount: 10, paid: false }],
    };

    it("emits exactly three callouts in event → deadline → bill order", () => {
      const out = buildHeroCallouts(fullInput);
      expect(out.map((c) => c.kind)).toEqual(["event", "deadline", "bill"]);
    });

    it("never exceeds three callouts and keeps the bill last", () => {
      const out = buildHeroCallouts(fullInput);
      expect(out).toHaveLength(3);
      expect(out.length).toBeLessThanOrEqual(3);
      expect(out.at(-1).kind).toBe("bill");
    });

    it("omits the bill but keeps event and deadline when no bill qualifies", () => {
      const out = buildHeroCallouts({ ...fullInput, bills: [] });
      expect(out.map((c) => c.kind)).toEqual(["event", "deadline"]);
    });
  });
});
