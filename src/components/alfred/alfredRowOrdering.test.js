import { describe, it, expect } from "vitest";
import {
  billsTotalDue,
  deadlineDone,
  emailDotState,
  eventPassed,
  groupAlfredRows,
  isOverdueYmd,
  nextEventId,
} from "./alfredRowOrdering.js";

// Fixed reference so bucketing is deterministic regardless of wall clock.
const NOW = new Date("2026-06-13T18:00:00.000Z");

describe("groupAlfredRows — email", () => {
  it("orders same-bucket emails newest first in a single unlabeled group", () => {
    const items = [
      { uid: "a", email_date: "2026-05-01T10:00:00.000Z" },
      { uid: "b", email_date: "2026-05-10T10:00:00.000Z" },
      { uid: "c", email_date: "2026-05-05T10:00:00.000Z" },
    ];
    const groups = groupAlfredRows("email", items, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBeNull();
    expect(groups[0].items.map((i) => i.uid)).toEqual(["b", "c", "a"]);
  });

  it("pins needs_attention emails into a leading 'Needs action' group", () => {
    const items = [
      { uid: "n", email_date: "2026-05-01T10:00:00.000Z", metadata: { lane: "needs_attention" } },
      { uid: "x", email_date: "2026-05-10T10:00:00.000Z" },
    ];
    const groups = groupAlfredRows("email", items, NOW);
    expect(groups[0].section).toEqual({ label: "Needs action", tone: "attention" });
    expect(groups[0].items.map((i) => i.uid)).toEqual(["n"]);
    // the pinned item is not duplicated in a later time bucket
    const rest = groups.slice(1).flatMap((g) => g.items.map((i) => i.uid));
    expect(rest).toEqual(["x"]);
  });

  it("buckets non-attention emails into Today / This week / Earlier, newest first, dropping empties", () => {
    const items = [
      { uid: "old1", email_date: "2026-05-20T10:00:00.000Z" },
      { uid: "today", email_date: "2026-06-13T10:00:00.000Z" },
      { uid: "old2", email_date: "2026-05-25T10:00:00.000Z" },
      { uid: "week", email_date: "2026-06-10T10:00:00.000Z" },
    ];
    const groups = groupAlfredRows("email", items, NOW);
    expect(groups.map((g) => g.section.label)).toEqual(["Today", "This week", "Earlier"]);
    expect(groups.every((g) => g.section.tone === "time")).toBe(true);
    expect(groups[0].items.map((i) => i.uid)).toEqual(["today"]);
    expect(groups[1].items.map((i) => i.uid)).toEqual(["week"]);
    expect(groups[2].items.map((i) => i.uid)).toEqual(["old2", "old1"]);
  });

  it("leaves non-email kinds in their original order as a single unlabeled group", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const groups = groupAlfredRows("event", items, NOW);
    expect(groups).toEqual([{ section: null, items }]);
  });
});

describe("emailDotState", () => {
  it("flags an unread email in the needs_attention lane", () => {
    expect(emailDotState({ read: false, metadata: { lane: "needs_attention" } }))
      .toEqual({ unread: true, attention: true });
  });

  it("a read email in a normal lane is neither unread nor attention", () => {
    expect(emailDotState({ read: true, metadata: { lane: "primary" } }))
      .toEqual({ unread: false, attention: false });
  });

  it("treats a missing read flag as read so it never shows a false unread dot", () => {
    expect(emailDotState({ metadata: {} })).toEqual({ unread: false, attention: false });
  });
});

describe("groupAlfredRows — event", () => {
  const NOW = new Date("2026-06-14T18:00:00.000Z"); // ~11am Pacific, Jun 14

  it("groups events by Pacific day, chronological, with Today/Tomorrow labels", () => {
    const items = [
      { id: "t2", startMs: Date.parse("2026-06-14T22:00:00.000Z") },
      { id: "tom", startMs: Date.parse("2026-06-15T17:00:00.000Z") },
      { id: "t1", startMs: Date.parse("2026-06-14T17:00:00.000Z") },
    ];
    const groups = groupAlfredRows("event", items, NOW);
    expect(groups.map((g) => g.section.label)).toEqual(["Today", "Tomorrow"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["t1", "t2"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["tom"]);
  });

  it("labels days beyond tomorrow with a weekday date and collapses a single day to no header", () => {
    const groups = groupAlfredRows("event", [
      { id: "a", startMs: Date.parse("2026-06-20T19:00:00.000Z") },
      { id: "b", startMs: Date.parse("2026-06-20T17:00:00.000Z") },
    ], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBeNull();
    expect(groups[0].items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("groupAlfredRows — deadline", () => {
  const NOW = new Date("2026-06-14T18:00:00.000Z"); // today Pacific = 2026-06-14

  it("sections by Overdue / Today / Upcoming and routes completed tasks to Done", () => {
    const items = [
      { id: "up", due_date: "2026-06-20", status: "incomplete" },
      { id: "od", due_date: "2026-06-10", status: "incomplete" },
      { id: "td", due_date: "2026-06-14", status: "incomplete" },
      { id: "dn", due_date: "2026-06-09", status: "complete" },
    ];
    const groups = groupAlfredRows("deadline", items, NOW);
    expect(groups.map((g) => g.section.label)).toEqual(["Overdue", "Today", "Upcoming", "Done"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["od"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["td"]);
    expect(groups[2].items.map((i) => i.id)).toEqual(["up"]);
    expect(groups[3].items.map((i) => i.id)).toEqual(["dn"]);
  });

  it("sorts open deadlines by due date ascending within a section", () => {
    const groups = groupAlfredRows("deadline", [
      { id: "later", due_date: "2026-06-25", status: "incomplete" },
      { id: "sooner", due_date: "2026-06-18", status: "incomplete" },
    ], NOW);
    expect(groups).toHaveLength(1); // single Upcoming bucket → header dropped
    expect(groups[0].section).toBeNull();
    expect(groups[0].items.map((i) => i.id)).toEqual(["sooner", "later"]);
  });
});

describe("deadlineDone", () => {
  it("reads status when no completed flag is present (the cached-row shape)", () => {
    expect(deadlineDone({ status: "complete" })).toBe(true);
    expect(deadlineDone({ status: "incomplete" })).toBe(false);
  });

  it("prefers an explicit completed boolean when present (projection shape)", () => {
    expect(deadlineDone({ completed: true, status: "incomplete" })).toBe(true);
    expect(deadlineDone({ completed: false, status: "complete" })).toBe(false);
  });
});

describe("groupAlfredRows — bill", () => {
  const NOW = new Date("2026-06-14T18:00:00.000Z");

  it("splits Due vs Paid and sorts each by due date ascending", () => {
    const items = [
      { id: "p1", next_date: "2026-06-05", paid: true, amount: 12.99 },
      { id: "d2", next_date: "2026-06-18", paid: false, amount: 70 },
      { id: "d1", next_date: "2026-06-14", paid: false, amount: 1850 },
    ];
    const groups = groupAlfredRows("bill", items, NOW);
    expect(groups.map((g) => g.section.label)).toEqual(["Due", "Paid"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["d1", "d2"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["p1"]);
  });
});

describe("row-level helpers", () => {
  const NOW = new Date("2026-06-14T18:00:00.000Z");

  it("billsTotalDue sums only unpaid amounts", () => {
    expect(billsTotalDue([
      { paid: false, amount: 1850 },
      { paid: true, amount: 12.99 },
      { paid: false, amount: 70 },
    ])).toBe(1920);
  });

  it("isOverdueYmd is true only for a date strictly before today", () => {
    expect(isOverdueYmd("2026-06-10", "2026-06-14")).toBe(true);
    expect(isOverdueYmd("2026-06-14", "2026-06-14")).toBe(false);
    expect(isOverdueYmd("", "2026-06-14")).toBe(false);
  });

  it("nextEventId picks the earliest event at or after now", () => {
    const items = [
      { id: "past", startMs: Date.parse("2026-06-14T15:00:00.000Z") },
      { id: "soon", startMs: Date.parse("2026-06-14T19:00:00.000Z") },
      { id: "later", startMs: Date.parse("2026-06-14T22:00:00.000Z") },
    ];
    expect(nextEventId(items, NOW)).toBe("soon");
  });

  it("eventPassed is true once the event end is before now", () => {
    expect(eventPassed({ startMs: Date.parse("2026-06-14T15:00:00.000Z"), endMs: Date.parse("2026-06-14T16:00:00.000Z") }, NOW)).toBe(true);
    expect(eventPassed({ startMs: Date.parse("2026-06-14T19:00:00.000Z"), endMs: Date.parse("2026-06-14T20:00:00.000Z") }, NOW)).toBe(false);
  });
});
