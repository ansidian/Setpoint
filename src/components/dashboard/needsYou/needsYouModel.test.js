import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildNeedsYouModel } from "./needsYouModel.js";

// Classification flows through daysUntil() (real Pacific wall clock), so freeze
// time here rather than threading an injected `now` — mirrors comingUpModel /
// ContextColumn (Tasks 10/13). The fixture dates classify against this instant:
// 2026-06-18 is overdue and 2026-06-19 is due-today at noon Pacific.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

const lanes = (over = {}) => ({
  needs_attention: [
    { id: 1, snapshot_item_id: 1, uid: "u1", lane: "needs_attention", from: "Riley Park", subject: "PR blocker: source retry copy", read: false, urgency: "high", date: "2026-06-19T18:42:00.000Z" },
    { id: 2, snapshot_item_id: 2, uid: "u2", lane: "needs_attention", from: "Jamie Rivera", subject: "Senior frontend screen — Thursday?", read: false, urgency: "high", date: "2026-06-19T18:00:00.000Z" },
  ],
  fyi: [
    { id: 3, snapshot_item_id: 3, uid: "u3", lane: "fyi", from: "Sync Monitor", subject: "Calendar coverage report", read: false, urgency: "low", date: "2026-06-19T17:00:00.000Z" },
  ],
  carryover: [],
  ...over,
});
const deadlines = {
  upcoming: [
    { id: "pr", title: "Respond to PR review: calendar source moves", due_date: "2026-06-18", status: "open", priority: 1, class_name: "Engineering" }, // overdue
    { id: "demolink", title: "Send portfolio demo link", due_date: "2026-06-19", status: "open", priority: 2, class_name: "Career" }, // due today
    { id: "later", title: "Walkthrough notes", due_date: "2026-06-22", status: "open", priority: 2, class_name: "Portfolio" }, // future → backfill
  ],
};
const bills = [
  { id: "rent", name: "Rent — Northstar Lofts", payee: "Northstar", amount: 2450, next_date: "2026-06-19", paid: false }, // due today
  { id: "electric", name: "Demo Electric", payee: "Demo Electric", amount: 146.32, next_date: "2026-06-23", paid: false }, // future → backfill
];

describe("buildNeedsYouModel count + color", () => {
  it("counts urgent emails + overdue/due-today deadlines + due-today unpaid bills, rose when anything overdue", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills });
    expect(m.countN).toBe(5);
    expect(m.countColor).toBe("var(--sp-rose)");
  });

  it("uses accent color when nothing is overdue", () => {
    const noOverdue = { upcoming: deadlines.upcoming.filter((d) => d.id !== "pr") };
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: noOverdue, liveBills: bills });
    expect(m.countColor).toBe("var(--sp-accent)");
  });

  it("is empty (count 0, accent) when no urgent items", () => {
    const m = buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(m.countN).toBe(0);
    expect(m.countColor).toBe("var(--sp-accent)");
    expect(m.urgentCards).toEqual([]);
  });
});

describe("buildNeedsYouModel breakdown + cards", () => {
  it("builds colored breakdown segments: N overdue (rose) · N due today (rose) · N urgent emails (cream)", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills });
    expect(m.breakdown).toEqual([
      { text: "1 overdue", color: "var(--sp-rose)" },
      { text: "2 due today", color: "var(--sp-rose)" },
      { text: "2 urgent emails", color: "var(--sp-cream)" },
    ]);
  });

  it("singularizes the email segment", () => {
    const oneEmail = lanes({ needs_attention: [lanes().needs_attention[0]] });
    const m = buildNeedsYouModel({ snapshotLanes: oneEmail, liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(m.breakdown).toEqual([{ text: "1 urgent email", color: "var(--sp-cream)" }]);
  });

  it("interleaves urgent cards by rank: overdue deadline, due-today bill, due-today deadline, then emails; capped at maxCards", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills, maxCards: 5 });
    expect(m.urgentCards.map((c) => c.id)).toEqual(["deadline:pr", "bill:rent", "deadline:demolink", "email:1", "email:2"]);
    expect(m.urgentCards.every((c) => c.kind === "urgent")).toBe(true);
    expect(m.backfillCards).toEqual([]);
    expect(m.moreCount).toBe(0);
  });

  it("backfills spare slots with the next upcoming items (quiet 'Coming up'), never overlapping urgent items", () => {
    const m = buildNeedsYouModel({
      snapshotLanes: lanes({ needs_attention: [lanes().needs_attention[0]] }),
      liveDeadlines: { upcoming: [deadlines.upcoming[2]] },
      liveBills: [bills[1]],
      maxCards: 5,
    });
    expect(m.urgentCards.map((c) => c.id)).toEqual(["email:1"]);
    expect(m.backfillCards.length).toBe(2);
    expect(m.backfillCards[0]).toMatchObject({ kind: "backfill", source: "Coming up", sourceIcon: "Clock" });
    expect(m.backfillCards[0].pill.tone).toBe("var(--sp-cream)");
    expect(m.backfillCards.map((c) => c.title)).toEqual(["Walkthrough notes", "Demo Electric"]);
  });

  it("emits moreCount/+N and suppresses backfill when urgent items overflow maxCards", () => {
    const manyEmails = { needs_attention: Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, snapshot_item_id: 100 + i, uid: `e${i}`, lane: "needs_attention", from: `S${i}`, subject: `Email ${i}`, read: false, urgency: "high" })), fyi: [], carryover: [] };
    const m = buildNeedsYouModel({ snapshotLanes: manyEmails, liveDeadlines: { upcoming: [deadlines.upcoming[2]] }, liveBills: [], maxCards: 5 });
    expect(m.urgentCards.length).toBe(5);
    expect(m.moreCount).toBe(1);
    expect(m.moreLabel).toBe("more item needs you");
    expect(m.backfillCards).toEqual([]);
  });
});

describe("buildNeedsYouModel email open/handled transitions + inbox rows", () => {
  it("Open (mark-read) flips the card to opened: MailOpen icon, 'opened, no reply yet' meta, STAYS in band", () => {
    const base = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [] });
    const openedEmailId = base.urgentCards.find((c) => c.email).id;
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [], opened: [openedEmailId] });
    const card = m.urgentCards.find((c) => c.id === openedEmailId);
    expect(card).toBeTruthy();
    expect(card.opened).toBe(true);
    expect(card.sourceIcon).toBe("MailOpen");
    expect(card.meta).toContain("opened, no reply yet");
  });

  it("keeps a READ but unhandled needs-attention email in the band — reading alone does not clear it", () => {
    const readLanes = lanes({ needs_attention: [{ ...lanes().needs_attention[0], read: true }] });
    const m = buildNeedsYouModel({ snapshotLanes: readLanes, liveDeadlines: { upcoming: [] }, liveBills: [] });
    const card = m.urgentCards.find((c) => c.email);
    expect(card).toBeTruthy();
    expect(card.id).toBe("email:1");
    expect(card.opened).toBe(true);          // read reflects as opened…
    expect(card.sourceIcon).toBe("MailOpen"); // …but it STAYS in the band
  });

  it("marks deadline cards completable (real completion) and bill cards not", () => {
    const m = buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: deadlines, liveBills: bills });
    expect(m.urgentCards.find((c) => c.id === "deadline:pr").completable).toBe(true);
    expect(m.urgentCards.find((c) => c.id === "bill:rent").completable).toBe(false);
  });

  it("Mark handled removes the email from BOTH the band and the inbox peek", () => {
    const base = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [] });
    const handledId = base.urgentCards.find((c) => c.email).id;
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [], handled: [handledId] });
    expect(m.urgentCards.find((c) => c.id === handledId)).toBeUndefined();
    expect(m.inboxRows.find((r) => r.id === handledId)).toBeUndefined();
  });

  it("inbox rows mirror the band lane: needs=rose solid dot, fyi=cyan solid dot, opened=hollow", () => {
    const openedId = "email:1";
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [], opened: [openedId] });
    const r1 = m.inboxRows.find((r) => r.id === "email:1");
    const fyi = m.inboxRows.find((r) => r.id === "email:3");
    expect(r1).toMatchObject({ lane: "needs_attention", dotTone: "var(--sp-rose)", dotState: "hollow" });
    expect(fyi).toMatchObject({ lane: "fyi", dotTone: "var(--sp-cyan)", dotState: "solid" });
    expect(r1.label).toBe("Riley Park · PR blocker: source retry copy");
  });

  it("inboxChip is 'N need you' (rose) when needs rows remain, else calm green", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(m.inboxChip).toMatchObject({ text: "2 need you", tone: "var(--sp-rose)", calm: false });
    const calm = buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(calm.inboxChip).toMatchObject({ text: "Inbox calm", tone: "var(--sp-green)", calm: true });
  });
});
